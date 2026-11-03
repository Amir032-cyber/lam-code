import { describe, expect, it } from 'vitest';
import { normalizePath, PathError, languageFromPath, isBinaryPath } from '@/lib/fs/paths';

describe('normalizePath', () => {
  it('normalise les chemins relatifs', () => {
    expect(normalizePath('./src//app.ts')).toBe('src/app.ts');
    expect(normalizePath('src\\lib\\a.ts')).toBe('src/lib/a.ts');
    expect(normalizePath('/index.html')).toBe('index.html');
  });
  it('refuse les remontées et chemins absolus', () => {
    expect(() => normalizePath('../secret')).toThrow(PathError);
    expect(() => normalizePath('src/../../x')).toThrow(PathError);
    expect(() => normalizePath('C:\\Windows\\system32')).toThrow(PathError);
    expect(() => normalizePath('//server/share')).toThrow(PathError);
    expect(() => normalizePath('~/.ssh/id_rsa')).toThrow(PathError);
  });
  it('détecte le langage et les binaires', () => {
    expect(languageFromPath('a/b.tsx')).toBe('typescript');
    expect(languageFromPath('Dockerfile')).toBe('dockerfile');
    expect(isBinaryPath('doc.pdf')).toBe(true);
    expect(isBinaryPath('a.ts')).toBe(false);
  });
});
