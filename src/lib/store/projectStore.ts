import { VirtualFS, makeFile, type VfsChange } from '../fs/vfs';
import { listProjects, saveProjectMeta, deleteProjectMeta, type ProjectMeta } from '../fs/persist';
import type { PlatformAdapter } from '../platform/types';
import { normalizePath } from '../fs/paths';
import { uid } from '../utils';

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

export interface TerminalSink {
  write(data: string): void;
}

export interface StoreState {
  project: ProjectMeta | null;
  projects: ProjectMeta[];
  openTabs: string[];
  activeFile: string | null;
  dirty: Record<string, string>;
  previewUrl: string | null;
  flash: Record<string, number>;
  loading: boolean;
  error: string | null;
}

const WELCOME_HTML = `<!doctype html>
<html lang="fr">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Nouveau projet LAM-Code</title>
  </head>
  <body style="font-family: system-ui; background: #0b0b0f; color: #e4e4e7; display: grid; place-items: center; height: 100vh; margin: 0">
    <main style="text-align: center">
      <h1>Bienvenue dans LAM-Code</h1>
      <p>Demandez à l'agent de construire quelque chose : cette page sera remplacée.</p>
    </main>
  </body>
</html>
`;

/** État global de l'espace de travail : projet courant, VFS, onglets et aperçu. */
export class ProjectStore {
  readonly vfs = new VirtualFS();
  private state: StoreState = {
    project: null,
    projects: [],
    openTabs: [],
    activeFile: null,
    dirty: {},
    previewUrl: null,
    flash: {},
    loading: true,
    error: null,
  };
  private listeners = new Set<() => void>();
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private terminals = new Set<TerminalSink>();
  private pendingChanges: VfsChange[] = [];

  constructor(readonly platform: PlatformAdapter) {
    this.vfs.subscribe((change) => this.onVfsChange(change));
  }

  getState = (): StoreState => this.state;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private set(patch: Partial<StoreState>) {
    this.state = { ...this.state, ...patch };
    for (const l of this.listeners) l();
  }

  attachTerminal(sink: TerminalSink): () => void {
    this.terminals.add(sink);
    return () => this.terminals.delete(sink);
  }

  writeTerminal(data: string) {
    for (const t of this.terminals) t.write(data);
  }

  setPreviewUrl(url: string | null) {
    this.set({ previewUrl: url });
  }

  private onVfsChange(change: VfsChange) {
    if (change.type === 'load') return;
    const patch: Partial<StoreState> = {};
    if (change.source === 'agent' && change.type === 'write') {
      patch.flash = { ...this.state.flash, [change.path]: Date.now() };
      if (!this.state.openTabs.includes(change.path)) patch.openTabs = [...this.state.openTabs, change.path];
      patch.activeFile = change.path;
    }
    if (change.type === 'remove') {
      const tabs = this.state.openTabs.filter((t) => t !== change.path && !t.startsWith(`${change.path}/`));
      patch.openTabs = tabs;
      if (this.state.activeFile && !tabs.includes(this.state.activeFile)) patch.activeFile = tabs.at(-1) ?? null;
    }
    if (change.type === 'rename' && change.to) {
      const move = (p: string) =>
        p === change.path || p.startsWith(`${change.path}/`) ? change.to + p.slice(change.path.length) : p;
      patch.openTabs = this.state.openTabs.map(move);
      patch.activeFile = this.state.activeFile ? move(this.state.activeFile) : null;
    }
    this.set(patch);
    this.pendingChanges.push(change);
    this.scheduleSave();
  }

  private scheduleSave() {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => void this.flush(), 300);
  }

  async flush() {
    const project = this.state.project;
    if (!project) return;
    const changes = this.pendingChanges.splice(0);
    if (changes.length === 0) return;
    try {
      if (project.workspacePath || this.platform.id === 'mobile') {
        for (const change of changes) {
          if (change.type === 'write') {
            const file = this.vfs.get(change.path);
            if (file) await this.platform.fs.writeFile(project, file);
          } else if (change.type === 'mkdir') await this.platform.fs.mkdir(project, change.path);
          else if (change.type === 'remove') await this.platform.fs.remove(project, change.path);
          else if (change.type === 'rename' && change.to) await this.platform.fs.rename(project, change.path, change.to);
        }
      } else {
        await this.platform.fs.saveProject(project, this.vfs.snapshot());
      }
      const meta = { ...project, updatedAt: Date.now() };
      await saveProjectMeta(meta);
      this.set({ project: meta, error: null });
    } catch (error) {
      this.set({ error: `Sauvegarde impossible : ${error instanceof Error ? error.message : String(error)}` });
    }
  }

  async init() {
    const projects = await listProjects();
    const lastId = localStorage.getItem('lam:lastProject');
    const target = projects.find((p) => p.id === lastId) ?? projects[0];
    if (target) await this.openProject(target, projects);
    else await this.createProject('Mon premier projet');
  }

  async openProject(project: ProjectMeta, projects?: ProjectMeta[]) {
    await this.flush();
    this.set({ loading: true });
    try {
      const files = await this.platform.fs.loadProject(project);
      this.vfs.load(files);
      localStorage.setItem('lam:lastProject', project.id);
      const first = files.files.find((f) => f.path === 'index.html') ?? files.files[0];
      this.set({
        project,
        projects: projects ?? (await listProjects()),
        openTabs: first ? [first.path] : [],
        activeFile: first?.path ?? null,
        dirty: {},
        previewUrl: null,
        loading: false,
        error: null,
      });
    } catch (error) {
      this.set({ loading: false, error: error instanceof Error ? error.message : String(error) });
    }
  }

  async createProject(name: string, workspacePath?: string) {
    const now = Date.now();
    const project: ProjectMeta = { id: uid(), name: name.trim() || 'Projet sans titre', createdAt: now, updatedAt: now, workspacePath };
    await saveProjectMeta(project);
    if (!workspacePath) {
      await this.platform.fs.saveProject(project, { files: [makeFile('index.html', WELCOME_HTML)], dirs: [] });
    }
    await this.openProject(project);
    return project;
  }

  async deleteProject(id: string) {
    await deleteProjectMeta(id);
    const projects = await listProjects();
    if (this.state.project?.id === id) {
      this.state = { ...this.state, project: null };
      if (projects[0]) await this.openProject(projects[0], projects);
      else await this.createProject('Mon premier projet');
    } else this.set({ projects });
  }

  async setWorkspace(path: string) {
    const project = this.state.project;
    if (!project) return;
    const meta = { ...project, workspacePath: path, updatedAt: Date.now() };
    await saveProjectMeta(meta);
    await this.openProject(meta);
  }

  async updateProjectMeta(patch: Partial<ProjectMeta>) {
    const project = this.state.project;
    if (!project) return;
    const meta = { ...project, ...patch };
    await saveProjectMeta(meta);
    this.set({ project: meta, projects: await listProjects() });
  }

  openFile(path: string) {
    const p = normalizePath(path);
    if (!this.vfs.get(p)) return;
    this.set({
      openTabs: this.state.openTabs.includes(p) ? this.state.openTabs : [...this.state.openTabs, p],
      activeFile: p,
    });
  }

  closeFile(path: string) {
    const tabs = this.state.openTabs.filter((t) => t !== path);
    const dirty = { ...this.state.dirty };
    delete dirty[path];
    this.set({
      openTabs: tabs,
      dirty,
      activeFile: this.state.activeFile === path ? (tabs.at(-1) ?? null) : this.state.activeFile,
    });
  }

  editBuffer(path: string, content: string) {
    const saved = this.vfs.get(path)?.content;
    const dirty = { ...this.state.dirty };
    if (content === saved) delete dirty[path];
    else dirty[path] = content;
    this.set({ dirty });
  }

  saveFile(path: string) {
    const content = this.state.dirty[path];
    if (content === undefined) return;
    this.vfs.write(path, content, 'user');
    const dirty = { ...this.state.dirty };
    delete dirty[path];
    this.set({ dirty });
  }

  async uploadFiles(files: File[], folder = 'uploads'): Promise<string[]> {
    const written: string[] = [];
    const rejected: string[] = [];
    for (const file of files) {
      if (file.size > MAX_UPLOAD_BYTES) {
        rejected.push(file.name);
        continue;
      }
      const path = normalizePath(`${folder}/${file.name}`);
      const isText = file.type.startsWith('text/') || /\.(txt|md|json|js|jsx|ts|tsx|css|html|py|rs|java|kt|dart|go|c|cpp|h|cs|php|rb|sh|ps1|ya?ml|toml|xml|svg|sql|csv)$/i.test(file.name);
      if (isText) this.vfs.write(path, await file.text(), 'user', 'utf8');
      else {
        const bytes = new Uint8Array(await file.arrayBuffer());
        let bin = '';
        for (let i = 0; i < bytes.length; i += 1) bin += String.fromCharCode(bytes[i]!);
        this.vfs.write(path, btoa(bin), 'user', 'base64');
      }
      written.push(path);
    }
    if (rejected.length) this.set({ error: `Fichier(s) trop volumineux (> 10 Mo) : ${rejected.join(', ')}` });
    return written;
  }

  clearError() {
    this.set({ error: null });
  }
}
