import { basename, dirname, isBinaryPath, isInside, mimeFromPath, normalizePath } from './paths';

export type FileEncoding = 'utf8' | 'base64';

export interface VFile {
  path: string;
  content: string;
  encoding: FileEncoding;
  mime: string;
  size: number;
  updatedAt: number;
}

export interface ProjectFiles {
  files: VFile[];
  dirs: string[];
}

export type ChangeSource = 'user' | 'agent' | 'system';

export interface VfsChange {
  type: 'write' | 'remove' | 'rename' | 'mkdir' | 'load';
  path: string;
  to?: string;
  source: ChangeSource;
}

type Listener = (change: VfsChange) => void;

export function byteLength(content: string, encoding: FileEncoding): number {
  if (encoding === 'base64') return Math.floor((content.length * 3) / 4);
  return new TextEncoder().encode(content).length;
}

export function makeFile(path: string, content: string, encoding: FileEncoding = 'utf8'): VFile {
  const normalized = normalizePath(path);
  return {
    path: normalized,
    content,
    encoding,
    mime: mimeFromPath(normalized),
    size: byteLength(content, encoding),
    updatedAt: Date.now(),
  };
}

/** Système de fichiers virtuel en mémoire, source de vérité de l'interface. */
export class VirtualFS {
  private files = new Map<string, VFile>();
  private dirs = new Set<string>();
  private listeners = new Set<Listener>();
  private version = 0;

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  getVersion(): number {
    return this.version;
  }

  private emit(change: VfsChange) {
    this.version += 1;
    for (const listener of this.listeners) listener(change);
  }

  load(data: ProjectFiles) {
    this.files.clear();
    this.dirs.clear();
    for (const file of data.files) this.files.set(file.path, file);
    for (const dir of data.dirs) this.dirs.add(dir);
    for (const file of data.files) this.addParents(file.path);
    this.emit({ type: 'load', path: '', source: 'system' });
  }

  snapshot(): ProjectFiles {
    return { files: [...this.files.values()], dirs: [...this.dirs] };
  }

  private addParents(path: string) {
    let dir = dirname(path);
    while (dir) {
      this.dirs.add(dir);
      dir = dirname(dir);
    }
  }

  exists(path: string): boolean {
    const p = normalizePath(path);
    return this.files.has(p) || this.dirs.has(p);
  }

  isDir(path: string): boolean {
    return this.dirs.has(normalizePath(path));
  }

  get(path: string): VFile | undefined {
    return this.files.get(normalizePath(path));
  }

  read(path: string): VFile {
    const file = this.get(path);
    if (!file) throw new Error(`Fichier introuvable : ${normalizePath(path)}`);
    return file;
  }

  write(path: string, content: string, source: ChangeSource = 'user', encoding?: FileEncoding) {
    const p = normalizePath(path);
    if (!p) throw new Error('Chemin vide');
    if (this.dirs.has(p)) throw new Error(`« ${p} » est un dossier`);
    const enc = encoding ?? (isBinaryPath(p) && /^[A-Za-z0-9+/=\s]+$/.test(content) ? 'base64' : 'utf8');
    const file = makeFile(p, content, enc);
    this.files.set(p, file);
    this.addParents(p);
    this.emit({ type: 'write', path: p, source });
    return file;
  }

  mkdir(path: string, source: ChangeSource = 'user') {
    const p = normalizePath(path);
    if (!p) return;
    if (this.files.has(p)) throw new Error(`« ${p} » est un fichier`);
    this.dirs.add(p);
    this.addParents(p);
    this.emit({ type: 'mkdir', path: p, source });
  }

  remove(path: string, source: ChangeSource = 'user') {
    const p = normalizePath(path);
    if (!this.exists(p)) throw new Error(`Introuvable : ${p}`);
    for (const key of [...this.files.keys()]) if (isInside(key, p)) this.files.delete(key);
    for (const key of [...this.dirs]) if (isInside(key, p)) this.dirs.delete(key);
    this.emit({ type: 'remove', path: p, source });
  }

  rename(from: string, to: string, source: ChangeSource = 'user') {
    const src = normalizePath(from);
    const dst = normalizePath(to);
    if (!this.exists(src)) throw new Error(`Introuvable : ${src}`);
    if (this.exists(dst)) throw new Error(`Existe déjà : ${dst}`);
    if (isInside(dst, src)) throw new Error('Impossible de déplacer un dossier dans lui-même');
    for (const [key, file] of [...this.files]) {
      if (!isInside(key, src)) continue;
      const next = dst + key.slice(src.length);
      this.files.delete(key);
      this.files.set(next, { ...file, path: next, mime: mimeFromPath(next), updatedAt: Date.now() });
    }
    for (const key of [...this.dirs]) {
      if (!isInside(key, src)) continue;
      this.dirs.delete(key);
      this.dirs.add(dst + key.slice(src.length));
    }
    this.addParents(dst);
    this.emit({ type: 'rename', path: src, to: dst, source });
  }

  listFiles(prefix = ''): VFile[] {
    const p = prefix ? normalizePath(prefix) : '';
    return [...this.files.values()]
      .filter((f) => isInside(f.path, p))
      .sort((a, b) => a.path.localeCompare(b.path));
  }

  listDirs(): string[] {
    return [...this.dirs].sort();
  }

  /** Arborescence texte (profondeur maximale configurable) destinée à l'agent. */
  tree(prefix = '', maxDepth = 4): string {
    const root = prefix ? normalizePath(prefix) : '';
    if (root && !this.exists(root)) throw new Error(`Introuvable : ${root}`);
    const entries = new Set<string>();
    for (const dir of this.dirs) if (isInside(dir, root) && dir !== root) entries.add(`${dir}/`);
    for (const file of this.files.keys()) if (isInside(file, root)) entries.add(file);
    const baseDepth = root ? root.split('/').length : 0;
    const lines: string[] = [];
    let hidden = 0;
    for (const entry of [...entries].sort()) {
      const clean = entry.endsWith('/') ? entry.slice(0, -1) : entry;
      const depth = clean.split('/').length - baseDepth;
      if (depth > maxDepth) {
        hidden += 1;
        continue;
      }
      const label = basename(clean) + (entry.endsWith('/') ? '/' : '');
      const size = this.files.get(clean)?.size;
      lines.push(`${'  '.repeat(depth - 1)}${label}${size !== undefined ? ` (${size} o)` : ''}`);
    }
    if (lines.length === 0) return '(projet vide)';
    if (hidden > 0) lines.push(`… ${hidden} entrée(s) plus profonde(s) masquée(s)`);
    return lines.join('\n');
  }
}
