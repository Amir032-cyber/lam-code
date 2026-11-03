import { describe, expect, it } from 'vitest';
import { VirtualFS } from '@/lib/fs/vfs';
import { buildStaticPreview } from '@/lib/preview';

describe('buildStaticPreview', () => {
  it('intègre CSS et JS locaux dans le document', () => {
    const vfs = new VirtualFS();
    vfs.write('index.html', '<html><head><link rel="stylesheet" href="style.css"></head><body><button id="b">Go</button><script src="app.js"></script></body></html>');
    vfs.write('style.css', 'button{color:red}');
    vfs.write('app.js', 'document.getElementById("b").onclick=()=>{}');
    const preview = buildStaticPreview(vfs);
    expect(preview?.entry).toBe('index.html');
    expect(preview?.html).toContain('button{color:red}');
    expect(preview?.html).toContain('getElementById');
    expect(preview?.html).not.toContain('href="style.css"');
  });
  it('renvoie null sans index.html', () => {
    expect(buildStaticPreview(new VirtualFS())).toBeNull();
  });
});
