import type { VirtualFS } from './fs/vfs';
import { dirname, normalizePath } from './fs/paths';

const ENTRY_CANDIDATES = ['index.html', 'public/index.html', 'dist/index.html', 'src/index.html'];

function resolve(from: string, ref: string): string | null {
  if (/^(https?:|data:|blob:|\/\/|#|mailto:)/i.test(ref)) return null;
  const clean = ref.split(/[?#]/)[0] ?? '';
  try {
    return clean.startsWith('/') ? normalizePath(clean) : normalizePath(`${dirname(from)}/${clean}`);
  } catch {
    return null;
  }
}

/**
 * Construit un document HTML autonome (CSS/JS locaux intégrés) pour l'aperçu statique :
 * l'iframe sandboxé sans allow-same-origin ne peut pas lire d'autres fichiers du projet.
 */
export function buildStaticPreview(vfs: VirtualFS): { entry: string; html: string } | null {
  const entry = ENTRY_CANDIDATES.find((p) => vfs.get(p)) ?? vfs.listFiles().find((f) => f.path.endsWith('.html'))?.path;
  if (!entry) return null;
  let html = vfs.read(entry).content;
  html = html.replace(/<link\b[^>]*rel=["']stylesheet["'][^>]*>/gi, (tag) => {
    const href = /href=["']([^"']+)["']/i.exec(tag)?.[1];
    const path = href ? resolve(entry, href) : null;
    const file = path ? vfs.get(path) : undefined;
    return file ? `<style data-src="${path}">\n${file.content}\n</style>` : tag;
  });
  html = html.replace(/<script\b([^>]*)\bsrc=["']([^"']+)["']([^>]*)><\/script>/gi, (tag, before: string, src: string, after: string) => {
    const path = resolve(entry, src);
    const file = path ? vfs.get(path) : undefined;
    if (!file) return tag;
    const attrs = `${before} ${after}`.replace(/\s+/g, ' ').trim();
    return `<script ${attrs} data-src="${path}">\n${file.content.replace(/<\/script>/gi, '<\\/script>')}\n</script>`;
  });
  html = html.replace(/(<img\b[^>]*\bsrc=["'])([^"']+)(["'])/gi, (tag, start: string, src: string, end: string) => {
    const path = resolve(entry, src);
    const file = path ? vfs.get(path) : undefined;
    if (!file) return tag;
    const data = file.encoding === 'base64' ? file.content : btoa(unescape(encodeURIComponent(file.content)));
    return `${start}data:${file.mime};base64,${data}${end}`;
  });
  return { entry, html };
}
