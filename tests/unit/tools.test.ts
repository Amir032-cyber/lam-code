import { describe, expect, it, vi } from 'vitest';
import { VirtualFS } from '@/lib/fs/vfs';
import { FailureTracker } from '@/lib/agent/policy';
import { executeTool, type ToolDeps } from '@/lib/agent/tools';
import type { ExecAdapter, PlatformAdapter } from '@/lib/platform/types';
import { makeFile } from '@/lib/fs/vfs';

function deps(exec: ExecAdapter | null): ToolDeps {
  const platform = {
    id: 'web',
    label: 'Web',
    badge: 'Cloud Sandbox',
    fs: {} as PlatformAdapter['fs'],
    secrets: {} as PlatformAdapter['secrets'],
    getExec: () => exec,
    execUnavailableReason: () => 'pas de shell',
  } satisfies PlatformAdapter;
  return {
    vfs: new VirtualFS(),
    platform,
    project: { id: 'p', name: 'p', createdAt: 0, updatedAt: 0 },
    failures: new FailureTracker(),
    signal: new AbortController().signal,
    onOutput: vi.fn(),
  };
}

describe('outils de l’agent', () => {
  it('write_file puis read_file et list_files', async () => {
    const d = deps(null);
    expect(await executeTool('write_file', { path: 'index.html', content: '<button>Go</button>' }, d)).toMatchObject({ created: true });
    expect(await executeTool('read_file', { path: 'index.html' }, d)).toMatchObject({ content: '<button>Go</button>' });
    const listing = (await executeTool('list_files', {}, d)) as { tree: string };
    expect(listing.tree).toContain('index.html');
  });
  it('refuse les chemins hors projet', async () => {
    await expect(executeTool('write_file', { path: '../x', content: '' }, deps(null))).rejects.toThrow();
  });
  it('bloque les commandes destructrices sans les exécuter', async () => {
    const run = vi.fn();
    const result = await executeTool('run_command', { cmd: 'rm -rf /' }, deps({ description: 'x', run }));
    expect(result).toMatchObject({ exitCode: 126 });
    expect(run).not.toHaveBeenCalled();
  });
  it('signale explicitement l’absence d’exécution', async () => {
    const result = await executeTool('run_command', { cmd: 'npm test' }, deps(null));
    expect(result).toMatchObject({ exitCode: 127 });
    expect((result as { stderr: string }).stderr).toContain('pas de shell');
  });
  it('exécute, réimporte les fichiers et suggère ask_user après 3 échecs', async () => {
    const run = vi.fn().mockResolvedValue({ exitCode: 1, stdout: '', stderr: 'boom', durationMs: 5, changedFiles: [makeFile('out.txt', 'généré')] });
    const d = deps({ description: 'x', run });
    await executeTool('run_command', { cmd: 'npm test' }, d);
    await executeTool('run_command', { cmd: 'npm test' }, d);
    const third = (await executeTool('run_command', { cmd: 'npm test' }, d)) as { note?: string };
    expect(third.note).toContain('ask_user');
    expect(d.vfs.read('out.txt').content).toBe('généré');
    expect(run.mock.calls[0]![0]).toMatchObject({ timeoutMs: 120_000, maxOutputBytes: 1024 * 1024 });
  });
});
