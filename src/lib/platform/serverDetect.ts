const URL_PATTERN = /https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1?\]):(\d{2,5})\/?/;

// eslint-disable-next-line no-control-regex
const ANSI = /\u001b\[[0-9;?]*[ -/]*[@-~]/g;

export function stripAnsi(text: string): string {
  return text.replace(ANSI, '');
}

/** Repère l'URL d'un serveur de dev local dans une sortie de terminal. */
export function detectServerUrl(output: string): { url: string; port: number } | null {
  const match = URL_PATTERN.exec(stripAnsi(output));
  if (!match) return null;
  const port = Number(match[1]);
  return { url: `http://localhost:${port}`, port };
}
