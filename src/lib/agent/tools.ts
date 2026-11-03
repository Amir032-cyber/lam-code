import type { ProjectMeta } from '../fs/persist';
import type { VirtualFS } from '../fs/vfs';
import { isBinaryPath, normalizePath } from '../fs/paths';
import type { OutputStream, PlatformAdapter } from '../platform/types';
import {
  checkCommand,
  DEFAULT_TIMEOUT_MS,
  FailureTracker,
  MAX_IDENTICAL_FAILURES,
  MAX_OUTPUT_BYTES,
  truncate,
} from './policy';
import {
  listFilesInput,
  readFileInput,
  runCommandInput,
  writeFileInput,
  type CommandResult,
} from './toolDefs';

export interface ToolDeps {
  vfs: VirtualFS;
  platform: PlatformAdapter;
  project: ProjectMeta;
  failures: FailureTracker;
  signal: AbortSignal;
  onOutput: (chunk: string, stream: OutputStream) => void;
  onCommandStart?: (cmd: string, cwd: string) => void;
  extractText?: (path: string) => Promise<string>;
}

export type ExecutableTool = 'read_file' | 'write_file' | 'list_files' | 'run_command';

export interface ReadFileOutput {
  path: string;
  content?: string;
  binary?: { mime: string; size: number; extractedText: string };
}

export interface RunCommandOutput extends CommandResult {
  note?: string;
}

export async function readFile(input: unknown, deps: ToolDeps): Promise<ReadFileOutput> {
  const { path } = readFileInput.parse(input);
  const file = deps.vfs.read(path);
  if (file.encoding === 'base64' || isBinaryPath(file.path)) {
    const extractedText = deps.extractText ? truncate(await deps.extractText(file.path)) : '';
    return { path: file.path, binary: { mime: file.mime, size: file.size, extractedText } };
  }
  return { path: file.path, content: truncate(file.content) };
}

export function writeFile(input: unknown, deps: ToolDeps) {
  const { path, content } = writeFileInput.parse(input);
  const existed = deps.vfs.exists(path);
  const file = deps.vfs.write(path, content, 'agent', 'utf8');
  return { path: file.path, bytes: file.size, created: !existed };
}

export function listFiles(input: unknown, deps: ToolDeps) {
  const { path } = listFilesInput.parse(input ?? {});
  return { path: path ? normalizePath(path) || '.' : '.', tree: deps.vfs.tree(path ?? '', 4) };
}

export async function runCommand(input: unknown, deps: ToolDeps): Promise<RunCommandOutput> {
  const { cmd, cwd } = runCommandInput.parse(input);
  const dir = cwd ? normalizePath(cwd) : '';
  if (dir && !deps.vfs.isDir(dir)) {
    return { exitCode: 1, stdout: '', stderr: `Dossier introuvable : ${dir}`, durationMs: 0 };
  }
  const decision = checkCommand(cmd);
  if (!decision.allowed) {
    return {
      exitCode: 126,
      stdout: '',
      stderr: `Commande refusée par la politique de sécurité : ${decision.reason}.`,
      durationMs: 0,
    };
  }
  const exec = deps.platform.getExec();
  if (!exec) {
    return {
      exitCode: 127,
      stdout: '',
      stderr: `Exécution indisponible : ${deps.platform.execUnavailableReason()}`,
      durationMs: 0,
      note: 'Ne réessaie pas cette commande : génère le code et explique comment l’exécuter ailleurs.',
    };
  }
  deps.onCommandStart?.(cmd, dir);
  const result = await exec.run({
    cmd,
    cwd: dir,
    project: deps.project,
    files: deps.vfs.snapshot(),
    timeoutMs: DEFAULT_TIMEOUT_MS,
    maxOutputBytes: MAX_OUTPUT_BYTES,
    signal: deps.signal,
    onOutput: deps.onOutput,
  });
  for (const file of result.changedFiles ?? []) {
    const current = deps.vfs.get(file.path);
    if (!current || current.content !== file.content) {
      deps.vfs.write(file.path, file.content, 'agent', file.encoding);
    }
  }
  for (const path of result.removedPaths ?? []) {
    if (deps.vfs.exists(path)) deps.vfs.remove(path, 'agent');
  }
  const count = deps.failures.record(cmd, result.exitCode, result.stderr);
  const output: RunCommandOutput = {
    exitCode: result.exitCode,
    stdout: truncate(result.stdout),
    stderr: truncate(result.stderr),
    durationMs: result.durationMs,
  };
  if (count >= MAX_IDENTICAL_FAILURES) {
    output.note = `Cette erreur s'est produite ${count} fois de suite. N'essaie plus : appelle ask_user pour demander de l'aide.`;
  }
  return output;
}

export async function executeTool(name: ExecutableTool, input: unknown, deps: ToolDeps): Promise<unknown> {
  switch (name) {
    case 'read_file':
      return readFile(input, deps);
    case 'write_file':
      return writeFile(input, deps);
    case 'list_files':
      return listFiles(input, deps);
    case 'run_command':
      return runCommand(input, deps);
  }
}

export function isExecutableTool(name: string): name is ExecutableTool {
  return name === 'read_file' || name === 'write_file' || name === 'list_files' || name === 'run_command';
}
