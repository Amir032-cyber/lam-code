export const DEFAULT_TIMEOUT_MS = 120_000;
export const MAX_OUTPUT_BYTES = 1024 * 1024;
export const MAX_TOOL_RESULT_CHARS = 20_000;
export const MAX_STEPS = 25;
export const MAX_IDENTICAL_FAILURES = 3;

interface Rule {
  pattern: RegExp;
  reason: string;
}

/** Motifs destructeurs refusés (liste noire, dupliquée côté Rust pour la défense en profondeur). */
export const BLOCKED_COMMANDS: Rule[] = [
  { pattern: /\brm\s+(-[a-zA-Z]*\s+)*-[a-zA-Z]*[rR][a-zA-Z]*\s+(-[a-zA-Z]+\s+)*(\/|~|\*|\$HOME|\.\.?)(\s|$|\/\*?(\s|$))/, reason: 'suppression récursive de la racine, du dossier personnel ou du projet' },
  { pattern: /\brm\s+.*--no-preserve-root/, reason: 'rm --no-preserve-root' },
  { pattern: /\bmkfs(\.\w+)?\b/, reason: 'formatage de disque' },
  { pattern: /(^|[\s;&|])format(\.com)?\s+[a-zA-Z]:/i, reason: 'formatage de disque' },
  { pattern: /\bformat-volume\b/i, reason: 'formatage de disque' },
  { pattern: /\bdd\s+.*\bof=\/dev\//, reason: 'écriture brute sur un périphérique' },
  { pattern: />\s*\/dev\/(sd|nvme|hd)[a-z]/, reason: 'écriture brute sur un périphérique' },
  { pattern: /\bdel\s+(.*\s)?\/[sq]\b/i, reason: 'suppression récursive Windows (del /s)' },
  { pattern: /\b(rd|rmdir)\s+(.*\s)?\/s\b/i, reason: 'suppression récursive Windows (rmdir /s)' },
  { pattern: /\bremove-item\b(?=.*-recurse)(?=.*(\s[a-zA-Z]:\\?|\s\\|\s~|\s\$env:))/i, reason: 'Remove-Item -Recurse hors du projet' },
  { pattern: /\b(shutdown|reboot|poweroff|halt)\b/i, reason: 'arrêt ou redémarrage de la machine' },
  { pattern: /\bstop-computer\b|\brestart-computer\b/i, reason: 'arrêt ou redémarrage de la machine' },
  { pattern: /\b(curl|wget|iwr|invoke-webrequest)\b[^|]*\|\s*(sudo\s+)?(sh|bash|zsh|iex|invoke-expression|powershell|pwsh)\b/i, reason: 'exécution d’un script téléchargé (curl | sh)' },
  { pattern: /:\(\)\s*\{\s*:\|:&\s*\};:/, reason: 'fork bomb' },
  { pattern: /\bchmod\s+(-R\s+)?[0-7]*777\s+\/(\s|$)/, reason: 'chmod 777 sur la racine' },
  { pattern: /\bchown\s+-R\s+\S+\s+\/(\s|$)/, reason: 'chown récursif sur la racine' },
  { pattern: /\breg\s+delete\b/i, reason: 'suppression de clé de registre' },
  { pattern: /\bbcdedit\b|\bdiskpart\b|\bcipher\s+\/w/i, reason: 'commande système dangereuse' },
  { pattern: /\bsudo\b/, reason: 'élévation de privilèges' },
  { pattern: /\bgit\s+push\b.*--force\b/, reason: 'git push --force' },
];

export interface PolicyDecision {
  allowed: boolean;
  reason?: string;
}

export function checkCommand(cmd: string): PolicyDecision {
  const command = cmd.trim();
  if (!command) return { allowed: false, reason: 'commande vide' };
  if (command.length > 4000) return { allowed: false, reason: 'commande trop longue' };
  for (const rule of BLOCKED_COMMANDS) {
    if (rule.pattern.test(command)) return { allowed: false, reason: rule.reason };
  }
  return { allowed: true };
}

export function truncate(text: string, max = MAX_TOOL_RESULT_CHARS): string {
  if (text.length <= max) return text;
  const omitted = text.length - max;
  return `${text.slice(0, max)}\n… [tronqué : ${omitted} caractère(s) omis]`;
}

/** Tronque une sortie de commande à la limite d'octets (1 Mo par défaut). */
export class OutputLimiter {
  private bytes = 0;
  private parts: string[] = [];
  truncated = false;

  constructor(private readonly limit = MAX_OUTPUT_BYTES) {}

  push(chunk: string): string {
    if (this.truncated) return '';
    const size = new TextEncoder().encode(chunk).length;
    if (this.bytes + size > this.limit) {
      const remaining = Math.max(0, this.limit - this.bytes);
      const kept = chunk.slice(0, remaining);
      this.parts.push(kept);
      this.bytes = this.limit;
      this.truncated = true;
      return kept;
    }
    this.bytes += size;
    this.parts.push(chunk);
    return chunk;
  }

  value(): string {
    return this.parts.join('') + (this.truncated ? '\n… [sortie tronquée à 1 Mo]' : '');
  }
}

/** Compte les échecs identiques pour limiter l'auto-correction à 3 tentatives. */
export class FailureTracker {
  private counts = new Map<string, number>();

  private key(cmd: string, stderr: string): string {
    const signature = stderr.replace(/\d+/g, '#').trim().split('\n').slice(-3).join('\n');
    return `${cmd.trim()}::${signature}`;
  }

  record(cmd: string, exitCode: number, stderr: string): number {
    if (exitCode === 0) {
      for (const k of [...this.counts.keys()]) if (k.startsWith(`${cmd.trim()}::`)) this.counts.delete(k);
      return 0;
    }
    const k = this.key(cmd, stderr);
    const next = (this.counts.get(k) ?? 0) + 1;
    this.counts.set(k, next);
    return next;
  }

  reset() {
    this.counts.clear();
  }
}
