import { cn, formatBytes } from '@/lib/utils';

describe('utils', () => {
  it('fusionne les classes Tailwind', () => {
    expect(cn('p-2', 'p-4')).toBe('p-4');
  });
  it('formate les tailles', () => {
    expect(formatBytes(512)).toBe('512 o');
    expect(formatBytes(2048)).toBe('2.0 Ko');
  });
});
