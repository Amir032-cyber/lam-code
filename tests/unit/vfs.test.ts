import { describe, expect, it, vi } from 'vitest';
import { VirtualFS } from '@/lib/fs/vfs';

describe('VirtualFS', () => {
  it('écrit, lit, renomme et supprime', () => {
    const vfs = new VirtualFS();
    const listener = vi.fn();
    vfs.subscribe(listener);
    vfs.write('src/a.ts', 'export const a = 1;');
    expect(vfs.isDir('src')).toBe(true);
    expect(vfs.read('src/a.ts').content).toBe('export const a = 1;');
    vfs.rename('src', 'lib');
    expect(vfs.get('lib/a.ts')).toBeDefined();
    expect(vfs.exists('src/a.ts')).toBe(false);
    vfs.remove('lib');
    expect(vfs.listFiles()).toHaveLength(0);
    expect(listener).toHaveBeenCalledTimes(3);
  });
  it('produit une arborescence limitée en profondeur', () => {
    const vfs = new VirtualFS();
    vfs.write('a/b/c/d/e/f.txt', 'x');
    vfs.write('index.html', '<h1>hi</h1>');
    const tree = vfs.tree('', 4);
    expect(tree).toContain('index.html');
    expect(tree).toContain('masquée');
    expect(new VirtualFS().tree()).toBe('(projet vide)');
  });
  it('refuse un renommage dans lui-même et les chemins dangereux', () => {
    const vfs = new VirtualFS();
    vfs.mkdir('a');
    expect(() => vfs.rename('a', 'a/b')).toThrow();
    expect(() => vfs.write('../x', '')).toThrow();
  });
});
