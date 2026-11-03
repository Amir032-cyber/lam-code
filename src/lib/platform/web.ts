import type { WebContainer } from '@webcontainer/api';
import { loadProjectFiles, saveProjectFiles, type ProjectMeta } from '../fs/persist';
import { makeFile, type ProjectFiles, type VFile } from '../fs/vfs';
import { isBinaryPath, isInside } from '../fs/paths';
import { OutputLimiter } from '../agent/policy';
import type { ExecAdapter, FileSystemAdapter, PlatformAdapter, RunOptions, RunResult } from './types';
import { WebSecretStore } from './webSecrets';

export class IndexedDbFs implements FileSystemAdapter {
  loadProject(project: ProjectMeta) {
    return loadProjectFiles(project.id);
  }

  saveProject(project: ProjectMeta, files: ProjectFiles) {
    return saveProjectFiles(project.id, files);
  }

  private async update(project: ProjectMeta, change: (data: ProjectFiles) => ProjectFiles) {
    await saveProjectFiles(project.id, change(await loadProjectFiles(project.id)));
  }

  writeFile(project: ProjectMeta, file: VFile) {
    return this.update(project, (d) => ({
      dirs: d.dirs,
      files: [...d.files.filter((f) => f.path !== file.path), file],
    }));
  }

  remove(project: ProjectMeta, path: string) {
    return this.update(project, (d) => ({
      dirs: d.dirs.filter((x) => !isInside(x, path)),
      files: d.files.filter((f) => !isInside(f.path, path)),
    }));
  }

  rename(project: ProjectMeta, from: string, to: string) {
    const move = (p: string) => (isInside(p, from) ? to + p.slice(from.length) : p);
    return this.update(project, (d) => ({
      dirs: d.dirs.map(move),
      files: d.files.map((f) => ({ ...f, path: move(f.path) })),
    }));
  }

  mkdir(project: ProjectMeta, path: string) {
    return this.update(project, (d) => ({ files: d.files, dirs: [...new Set([...d.dirs, path])] }));
  }
}

const SKIP_DIRS = new Set(['node_modules', '.git', '.cache', '.npm', '.pnpm-store']);
const MAX_IMPORT_FILES = 800;
const MAX_IMPORT_SIZE = 512 * 1024;

function toBytes(base64: string): Uint8Array {
  const bin = atob(base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function toBase64(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 1) bin += String.fromCharCode(bytes[i]!);
  return btoa(bin);
}

let bootPromise: Promise<WebContainer> | null = null;

async function getContainer(): Promise<WebContainer> {
  bootPromise ??= import('@webcontainer/api').then(({ WebContainer }) =>
    WebContainer.boot({ coep: 'require-corp', workdirName: 'project' }),
  );
  return bootPromise;
}

/** Exécution Node/npm dans le navigateur via WebContainer (StackBlitz). */
export class WebContainerExec implements ExecAdapter {
  description = 'WebContainer (Node.js/npm dans le navigateur)';
  private synced = new Map<string, number>();
  private listeners = new Set<(url: string, port: number) => void>();
  private hooked = false;

  private async container() {
    const wc = await getContainer();
    if (!this.hooked) {
      this.hooked = true;
      wc.on('server-ready', (port, url) => {
        for (const l of this.listeners) l(url, port);
      });
    }
    return wc;
  }

  onServerReady(listener: (url: string, port: number) => void) {
    this.listeners.add(listener);
    void this.container();
    return () => {
      this.listeners.delete(listener);
    };
  }

  private async sync(wc: WebContainer, files: ProjectFiles) {
    for (const dir of files.dirs) await wc.fs.mkdir(dir, { recursive: true });
    for (const file of files.files) {
      if (this.synced.get(file.path) === file.updatedAt) continue;
      const parent = file.path.includes('/') ? file.path.slice(0, file.path.lastIndexOf('/')) : '';
      if (parent) await wc.fs.mkdir(parent, { recursive: true });
      await wc.fs.writeFile(file.path, file.encoding === 'base64' ? toBytes(file.content) : file.content);
      this.synced.set(file.path, file.updatedAt);
    }
  }

  private async readBack(wc: WebContainer, known: ProjectFiles): Promise<{ changed: VFile[]; removed: string[] }> {
    const byPath = new Map(known.files.map((f) => [f.path, f]));
    const seen = new Set<string>();
    const changed: VFile[] = [];
    const walk = async (dir: string) => {
      const entries = await wc.fs.readdir(dir || '.', { withFileTypes: true });
      for (const entry of entries) {
        if (seen.size >= MAX_IMPORT_FILES) return;
        const path = dir ? `${dir}/${entry.name}` : entry.name;
        if (entry.isDirectory()) {
          if (!SKIP_DIRS.has(entry.name)) await walk(path);
          continue;
        }
        seen.add(path);
        const bytes = await wc.fs.readFile(path);
        if (bytes.length > MAX_IMPORT_SIZE) continue;
        const binary = isBinaryPath(path);
        const content = binary ? toBase64(bytes) : new TextDecoder().decode(bytes);
        const previous = byPath.get(path);
        if (previous && previous.content === content) continue;
        const file = makeFile(path, content, binary ? 'base64' : 'utf8');
        changed.push(file);
        this.synced.set(path, file.updatedAt);
      }
    };
    await walk('');
    const removed =
      seen.size >= MAX_IMPORT_FILES ? [] : known.files.map((f) => f.path).filter((p) => !seen.has(p));
    return { changed, removed };
  }

  async run(options: RunOptions): Promise<RunResult> {
    const started = Date.now();
    const wc = await this.container();
    await this.sync(wc, options.files);
    const process = await wc.spawn('jsh', ['-c', options.cmd], {
      cwd: options.cwd || undefined,
      terminal: { cols: 120, rows: 30 },
    });
    const output = new OutputLimiter(options.maxOutputBytes);
    void process.output.pipeTo(
      new WritableStream({
        write(chunk) {
          const kept = output.push(chunk);
          if (kept) options.onOutput(kept, 'stdout');
        },
      }),
    );

    let serverUrl: string | null = null;
    const serverReady = new Promise<number>((resolve) => {
      const off = this.onServerReady((url) => {
        serverUrl = url;
        off();
        resolve(0);
      });
    });
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<number>((resolve) => {
      timer = setTimeout(() => resolve(124), options.timeoutMs);
    });
    const aborted = new Promise<number>((resolve) => {
      if (options.signal.aborted) resolve(130);
      options.signal.addEventListener('abort', () => resolve(130), { once: true });
    });
    const exitCode = await Promise.race([process.exit, serverReady, timeout, aborted]);
    clearTimeout(timer);
    if (exitCode === 124 || exitCode === 130) process.kill();

    const text = output.value();
    const { changed, removed } = await this.readBack(wc, options.files);
    let stdout = text;
    let stderr = '';
    if (exitCode === 124) stderr = `Délai dépassé (${Math.round(options.timeoutMs / 1000)} s) : processus arrêté.`;
    else if (exitCode === 130) stderr = 'Commande annulée par l’utilisateur.';
    else if (exitCode !== 0) {
      stderr = text.slice(-8000);
      stdout = text.slice(0, Math.max(0, text.length - 8000));
    }
    if (serverUrl) stdout += `\n[Serveur de dev démarré en arrière-plan : ${serverUrl} — aperçu ouvert]`;
    return { exitCode, stdout, stderr, durationMs: Date.now() - started, changedFiles: changed, removedPaths: removed };
  }
}

export function createWebPlatform(): PlatformAdapter {
  let exec: WebContainerExec | null = null;
  return {
    id: 'web',
    label: 'Web',
    badge: 'Cloud Sandbox',
    fs: new IndexedDbFs(),
    secrets: new WebSecretStore(),
    getExec() {
      if (typeof window === 'undefined' || !window.crossOriginIsolated) return null;
      exec ??= new WebContainerExec();
      return exec;
    },
    execUnavailableReason() {
      return 'la page n’est pas isolée (en-têtes COOP/COEP absents) : WebContainer ne peut pas démarrer.';
    },
  };
}
