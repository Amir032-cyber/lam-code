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
    } else {
      const bytes = await entry.async('uint8array');
      const text = isBinaryPath(path) ? null : decodeUtf8(bytes);
      out.files.push(text === null ? makeFile(path, toBase64(bytes), 'base64') : makeFile(path, text));
    }
  }
  return out;
}

/** Texte UTF-8 valide (sans octet nul), sinon null : le fichier est alors conservé en base64. */
function decodeUtf8(bytes: Uint8Array): string | null {
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return text.includes('\0') ? null : text;
  } catch {
    return null;
  }
}

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}
