import type { CommandResult } from '../agent/toolDefs';
import type { ProjectMeta } from '../fs/persist';
import type { ProjectFiles, VFile } from '../fs/vfs';
import type { PlatformId } from '../agent/systemPrompt';

export type OutputStream = 'stdout' | 'stderr';

export interface RunOptions {
  cmd: string;
  cwd: string;
  project: ProjectMeta;
  files: ProjectFiles;
  timeoutMs: number;
  maxOutputBytes: number;
  signal: AbortSignal;
  onOutput: (chunk: string, stream: OutputStream) => void;
}

export interface RunResult extends CommandResult {
  /** Fichiers modifiés par la commande (à réimporter dans le VFS). */
  changedFiles?: VFile[];
  removedPaths?: string[];
}

export interface ExecAdapter {
  description: string;
  run(options: RunOptions): Promise<RunResult>;
  onServerReady?(listener: (url: string, port: number) => void): () => void;
}

/** Persistance des fichiers d'un projet sur la plateforme. */
export interface FileSystemAdapter {
  loadProject(project: ProjectMeta): Promise<ProjectFiles>;
  saveProject(project: ProjectMeta, files: ProjectFiles): Promise<void>;
  writeFile(project: ProjectMeta, file: VFile): Promise<void>;
  remove(project: ProjectMeta, path: string): Promise<void>;
  rename(project: ProjectMeta, from: string, to: string): Promise<void>;
  mkdir(project: ProjectMeta, path: string): Promise<void>;
}

export interface SecretStore {
  get(name: string): Promise<string | null>;
  set(name: string, value: string): Promise<void>;
  remove(name: string): Promise<void>;
  description: string;
}

export interface PlatformAdapter {
  id: PlatformId;
  label: string;
  badge: 'Cloud Sandbox' | 'Local Environment';
  fs: FileSystemAdapter;
  secrets: SecretStore;
  /** null si aucune exécution n'est possible : `execUnavailableReason` explique pourquoi. */
  getExec(): ExecAdapter | null;
  execUnavailableReason(): string;
  pickWorkspace?(): Promise<string | null>;
}

export class ExecUnavailableError extends Error {
  constructor(reason: string) {
    super(`Exécution indisponible : ${reason}`);
    this.name = 'ExecUnavailableError';
  }
}
