// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { makeFile } from '@/lib/fs/vfs';
import { unzipProject, zipProject } from '@/lib/cloud/zip';

describe('snapshots zip', () => {
  it('fait un aller-retour texte + binaire', async () => {
    const files = {
      dirs: ['src', 'empty'],
      files: [makeFile('src/index.html', '<h1>é</h1>'), makeFile('logo.png', 'iVBORw0KGgo=', 'base64')],
    };
    const blob = await zipProject(files);
    const back = await unzipProject(await blob.arrayBuffer());
    expect(back.files.find((f) => f.path === 'src/index.html')?.content).toBe('<h1>é</h1>');
    expect(back.files.find((f) => f.path === 'logo.png')).toMatchObject({ encoding: 'base64', content: 'iVBORw0KGgo=' });
    expect(back.dirs).toContain('empty');
  });

  it('conserve les octets d’un binaire à extension inconnue', async () => {
    const blob = await zipProject({ dirs: [], files: [makeFile('assets/model.bin', '//4AAQ==', 'base64')] });
    const back = await unzipProject(await blob.arrayBuffer());
    expect(back.files[0]).toMatchObject({ path: 'assets/model.bin', encoding: 'base64', content: '//4AAQ==' });
  });
});
