export class PathError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PathError';
  }
}

/**
 * Normalise un chemin relatif à la racine du projet.
 * Refuse les chemins absolus (/, C:\, \\serveur) et toute remontée « .. ».
 */
export function normalizePath(input: string): string {
  if (typeof input !== 'string') throw new PathError('Chemin invalide');
  const raw = input.trim().replace(/\\/g, '/');
  if (raw.startsWith('/') && !raw.startsWith('//')) {
    // « /src/a.ts » est toléré comme relatif à la racine du projet
  } else if (raw.startsWith('//') || /^[a-zA-Z]:/.test(raw) || raw.startsWith('~')) {
    throw new PathError(`Chemin absolu refusé : ${input}`);
  }
  const parts: string[] = [];
  for (const segment of raw.split('/')) {
    if (segment === '' || segment === '.') continue;
    if (segment === '..') throw new PathError(`Remontée « .. » refusée : ${input}`);
    if (segment.includes('\0')) throw new PathError('Caractère nul refusé');
    parts.push(segment);
  }
  return parts.join('/');
}

export function dirname(path: string): string {
  const index = path.lastIndexOf('/');
  return index === -1 ? '' : path.slice(0, index);
}

export function basename(path: string): string {
  const index = path.lastIndexOf('/');
  return index === -1 ? path : path.slice(index + 1);
}

export function extname(path: string): string {
  const name = basename(path);
  const index = name.lastIndexOf('.');
  return index <= 0 ? '' : name.slice(index + 1).toLowerCase();
}

export function joinPath(...parts: string[]): string {
  return normalizePath(parts.filter(Boolean).join('/'));
}

export function isInside(path: string, folder: string): boolean {
  return folder === '' || path === folder || path.startsWith(`${folder}/`);
}

const LANGUAGES: Record<string, string> = {
  ts: 'typescript',
  tsx: 'typescript',
  mts: 'typescript',
  cts: 'typescript',
  js: 'javascript',
  jsx: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  json: 'json',
  html: 'html',
  htm: 'html',
  css: 'css',
  scss: 'scss',
  less: 'less',
  md: 'markdown',
  py: 'python',
  rs: 'rust',
  go: 'go',
  java: 'java',
  kt: 'kotlin',
  dart: 'dart',
  c: 'c',
  h: 'c',
  cpp: 'cpp',
  hpp: 'cpp',
  cs: 'csharp',
  php: 'php',
  rb: 'ruby',
  swift: 'swift',
  sh: 'shell',
  bash: 'shell',
  ps1: 'powershell',
  yml: 'yaml',
  yaml: 'yaml',
  toml: 'ini',
  ini: 'ini',
  xml: 'xml',
  svg: 'xml',
  sql: 'sql',
  vue: 'html',
  svelte: 'html',
  dockerfile: 'dockerfile',
};

export function languageFromPath(path: string): string {
  const name = basename(path).toLowerCase();
  if (name === 'dockerfile') return 'dockerfile';
  if (name === 'makefile') return 'makefile';
  return LANGUAGES[extname(path)] ?? 'plaintext';
}

const BINARY_EXTENSIONS = new Set([
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'ico', 'pdf', 'zip', 'gz', 'tar', 'wasm',
  'mp3', 'mp4', 'wav', 'ogg', 'woff', 'woff2', 'ttf', 'otf', 'exe', 'dll', 'so', 'apk',
]);

export function isBinaryPath(path: string): boolean {
  return BINARY_EXTENSIONS.has(extname(path));
}

export function mimeFromPath(path: string): string {
  const ext = extname(path);
  const map: Record<string, string> = {
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    webp: 'image/webp',
    svg: 'image/svg+xml',
    pdf: 'application/pdf',
    html: 'text/html',
    css: 'text/css',
    js: 'text/javascript',
    json: 'application/json',
  };
  return map[ext] ?? (isBinaryPath(path) ? 'application/octet-stream' : 'text/plain');
}
