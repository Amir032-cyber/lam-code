import JSZip from 'jszip';
import { isBinaryPath } from '@/lib/fs/paths';
import { makeFile, type ProjectFiles } from '@/lib/fs/vfs';

export async function zipProject(files: ProjectFiles): Promise<Blob> {
  const zip = new JSZip();
  for (const dir of files.dirs) zip.folder(dir);
  for (const file of files.files) zip.file(file.path, file.content, { base64: file.encoding === 'base64' });
  return zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
}

export async function unzipProject(data: Blob | ArrayBuffer): Promise<ProjectFiles> {
  const zip = await JSZip.loadAsync(data);
  const out: ProjectFiles = { files: [], dirs: [] };
  for (const entry of Object.values(zip.files)) {
    const path = entry.name.replace(/\/$/, '');
    if (!path) continue;
    if (entry.dir) {
      out.dirs.push(path);
    } else if (isBinaryPath(path)) {
      out.files.push(makeFile(path, await entry.async('base64'), 'base64'));
    } else {
      out.files.push(makeFile(path, await entry.async('string')));
    }
  }
  return out;
}
