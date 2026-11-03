import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import type { ProjectMeta } from '../fs/persist';
import type { ProjectFiles, VFile } from '../fs/vfs';
import { uid } from '../utils';
import type { CommandResult } from '../agent/toolDefs';
import type { ExecAdapter, FileSystemAdapter, OutputStream, PlatformAdapter, RunOptions, RunResult, SecretStore } from './types';
import { IndexedDbFs } from './web';
import { detectServerUrl } from './serverDetect';

interface OutputEvent {
  id: string;
  stream: OutputStream;
  data: string;
}

function workspace(project: ProjectMeta): string {
  if (!project.workspacePath) throw new Error('Aucun dossier de travail : choisissez un dossier pour ce projet.');
  return project.workspacePath;
}

/** Fichiers réels du dossier de travail choisi (commandes Rust confinées à ce dossier). */
class TauriFs implements FileSystemAdapter {
  private fallback = new IndexedDbFs();

  loadProject(project: ProjectMeta): Promise<ProjectFiles> {
    if (!project.workspacePath) return this.fallback.loadProject(project);
    return invoke<ProjectFiles>('fs_load', { workspace: project.workspacePath });
  }

  async saveProject(project: ProjectMeta, files: ProjectFiles) {
    if (!project.workspacePath) return this.fallback.saveProject(project, files);
    for (const dir of files.dirs) await this.mkdir(project, dir);
    for (const file of files.files) await this.writeFile(project, file);
  }

  writeFile(project: ProjectMeta, file: VFile) {
    if (!project.workspacePath) return this.fallback.writeFile(project, file);
    return invoke<void>('fs_write', {
      workspace: workspace(project),
      path: file.path,
      content: file.content,
      encoding: file.encoding,
    });
  }

  remove(project: ProjectMeta, path: string) {
    if (!project.workspacePath) return this.fallback.remove(project, path);
    return invoke<void>('fs_remove', { workspace: workspace(project), path });
  }

  rename(project: ProjectMeta, from: string, to: string) {
    if (!project.workspacePath) return this.fallback.rename(project, from, to);
    return invoke<void>('fs_rename', { workspace: workspace(project), from, to });
  }

  mkdir(project: ProjectMeta, path: string) {
    if (!project.workspacePath) return this.fallback.mkdir(project, path);
    return invoke<void>('fs_mkdir', { workspace: workspace(project), path });
  }
}

/** Shell Windows réel (PowerShell) avec streaming, timeout et annulation côté Rust. */
class TauriExec implements ExecAdapter {
  description = 'Shell local (PowerShell) dans le dossier de travail';
  private listeners = new Set<(url: string, port: number) => void>();
  private servers = new Set<string>();

  onServerReady(listener: (url: string, port: number) => void) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  async run(options: RunOptions): Promise<RunResult> {
    const ws = workspace(options.project);
    const id = uid();
    let seen = '';
    let resolveServer: (url: string) => void = () => undefined;
    const serverReady = new Promise<string>((resolve) => {
      resolveServer = resolve;
    });
    const unlisten = await listen<OutputEvent>('cmd-output', (event) => {
      if (event.payload.id !== id) return;
      options.onOutput(event.payload.data, event.payload.stream);
      seen = (seen + event.payload.data).slice(-4000);
      const server = detectServerUrl(seen);
      if (server) {
        for (const l of this.listeners) l(server.url, server.port);
        resolveServer(server.url);
      }
    });
    const onAbort = () => void invoke('cancel_command', { id });
    options.signal.addEventListener('abort', onAbort, { once: true });
    const started = Date.now();
    try {
      const done = invoke<CommandResult>('run_command', {
        id,
        cmd: options.cmd,
        cwd: options.cwd,
        workspace: ws,
        timeoutMs: options.timeoutMs,
        maxOutputBytes: options.maxOutputBytes,
      });
      const outcome = await Promise.race([
        done.then((result) => ({ kind: 'done' as const, result })),
        serverReady.then((url) => ({ kind: 'server' as const, url })),
      ]);
      if (outcome.kind === 'server') {
        // Un seul serveur de dev à la fois ; il survit au délai et s'arrête à la fermeture de l'app.
        for (const previous of this.servers) void invoke('cancel_command', { id: previous });
        this.servers.clear();
        this.servers.add(id);
        void done.finally(() => this.servers.delete(id));
        await invoke('detach_command', { id });
        const after = await invoke<ProjectFiles>('fs_load', { workspace: ws });
        return {
          exitCode: 0,
          stdout: `${seen}\n[Serveur de dev démarré en arrière-plan : ${outcome.url} — aperçu ouvert]`,
          stderr: '',
          durationMs: Date.now() - started,
          changedFiles: after.files,
          removedPaths: removedPaths(options.files, after),
        };
      }
      const after = await invoke<ProjectFiles>('fs_load', { workspace: ws });
      return { ...outcome.result, changedFiles: after.files, removedPaths: removedPaths(options.files, after) };
    } finally {
      options.signal.removeEventListener('abort', onAbort);
      unlisten();
    }
  }
}

const IGNORED_DIRS = new Set(['node_modules', '.git', 'target', 'dist', 'build', '.next', '.venv', '__pycache__']);
const MAX_SCANNED_FILES = 2000;
const MAX_SCANNED_BYTES = 1024 * 1024;

/** Fichiers présents avant la commande et absents du disque après (hors dossiers ignorés par fs_load). */
export function removedPaths(before: ProjectFiles, after: ProjectFiles): string[] {
  if (after.files.length >= MAX_SCANNED_FILES) return [];
  const present = new Set([...after.files.map((f) => f.path), ...after.dirs]);
  const scanned = (path: string) => !path.split('/').some((part) => IGNORED_DIRS.has(part));
  return [
    ...before.files.filter((f) => f.size <= MAX_SCANNED_BYTES && scanned(f.path) && !present.has(f.path)).map((f) => f.path),
    ...before.dirs.filter((d) => scanned(d) && !present.has(d)),
  ];
}

/** Clés stockées dans le Gestionnaire d'identifiants Windows (crate keyring). */
class KeyringSecrets implements SecretStore {
  description = 'Gestionnaire d’identifiants Windows';
  get(name: string) {
    return invoke<string | null>('secret_get', { name });
  }
  set(name: string, value: string) {
    return invoke<void>('secret_set', { name, value });
  }
  remove(name: string) {
    return invoke<void>('secret_delete', { name });
  }
}

export function createTauriPlatform(): PlatformAdapter {
  const exec = new TauriExec();
  return {
    id: 'desktop',
    label: 'Windows',
    badge: 'Local Environment',
    fs: new TauriFs(),
    secrets: new KeyringSecrets(),
    getExec: () => exec,
    execUnavailableReason: () => 'choisissez un dossier de travail pour ce projet.',
    // Boîte de dialogue native côté Rust : seul un dossier choisi ici est autorisé pour les commandes fs/shell.
    pickWorkspace: () => invoke<string | null>('pick_workspace'),
  };
}
