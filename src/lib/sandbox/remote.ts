import type { ExecAdapter, RunOptions, RunResult } from '../platform/types';
import { makeFile, type FileEncoding } from '../fs/vfs';
import { OutputLimiter } from '../agent/policy';

interface RemoteFile {
  path: string;
  content: string;
  encoding?: FileEncoding;
}

interface RemoteResponse {
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs?: number;
  files?: RemoteFile[];
  removed?: string[];
}

/**
 * Sandbox distant HTTP (Android) : POST {url}/exec avec les fichiers du projet,
 * protocole décrit dans docs/REMOTE_SANDBOX.md.
 */
export class RemoteSandbox implements ExecAdapter {
  constructor(
    private readonly url: string,
    private readonly token: () => Promise<string | null>,
  ) {}

  get description() {
    return `Sandbox distant (${new URL(this.url).host})`;
  }

  async run(options: RunOptions): Promise<RunResult> {
    const started = Date.now();
    const token = await this.token();
    const timeout = AbortSignal.timeout(options.timeoutMs);
    const signal = AbortSignal.any([options.signal, timeout]);
    const response = await fetch(`${this.url.replace(/\/$/, '')}/exec`, {
      method: 'POST',
      signal,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({
        cmd: options.cmd,
        cwd: options.cwd,
        timeoutMs: options.timeoutMs,
        files: options.files.files.map((f) => ({ path: f.path, content: f.content, encoding: f.encoding })),
      }),
    });
    if (!response.ok) {
      throw new Error(`Sandbox distant : HTTP ${response.status} ${await response.text()}`);
    }
    const data = (await response.json()) as RemoteResponse;
    const out = new OutputLimiter(options.maxOutputBytes);
    const err = new OutputLimiter(options.maxOutputBytes);
    const stdout = out.push(data.stdout ?? '');
    const stderr = err.push(data.stderr ?? '');
    if (stdout) options.onOutput(stdout, 'stdout');
    if (stderr) options.onOutput(stderr, 'stderr');
    return {
      exitCode: data.exitCode,
      stdout: out.value(),
      stderr: err.value(),
      durationMs: data.durationMs ?? Date.now() - started,
      changedFiles: (data.files ?? []).map((f) => makeFile(f.path, f.content, f.encoding ?? 'utf8')),
      removedPaths: data.removed ?? [],
    };
  }
}

export async function testSandbox(url: string, token: string | null): Promise<string> {
  const response = await fetch(`${url.replace(/\/$/, '')}/health`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.text();
}
