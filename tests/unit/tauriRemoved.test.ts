import { describe, expect, it, vi } from 'vitest';
import { makeFile } from '@/lib/fs/vfs';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn() }));

const { removedPaths } = await import('@/lib/platform/tauri');

describe('removedPaths (Tauri)', () => {
  it('signale les fichiers supprimés par une commande, hors dossiers ignorés', () => {
    const before = {
      dirs: ['old', 'src'],
      files: [makeFile('obsolete.txt', 'x'), makeFile('src/a.ts', 'a'), makeFile('node_modules/p/index.js', 'm')],
    };
    const after = { dirs: ['src'], files: [makeFile('src/a.ts', 'a')] };
    expect(removedPaths(before, after).sort()).toEqual(['obsolete.txt', 'old']);
  });
});
