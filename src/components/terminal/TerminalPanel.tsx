import { useEffect, useRef, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { Eraser, Play, Square } from 'lucide-react';
import { useApp } from '@/app/AppContext';
import { Button } from '@/components/ui/button';
import { checkCommand, DEFAULT_TIMEOUT_MS, MAX_OUTPUT_BYTES } from '@/lib/agent/policy';
import { toTerminal } from '@/hooks/useAgent';

/** Terminal xterm.js : affiche les sorties de l'agent et permet de lancer ses propres commandes. */
export function TerminalPanel() {
  const { store, platform, t } = useApp();
  const container = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const [command, setCommand] = useState('');
  const [running, setRunning] = useState<AbortController | null>(null);

  useEffect(() => {
    if (!container.current) return;
    const term = new Terminal({
      convertEol: false,
      fontSize: 13,
      fontFamily: 'JetBrains Mono, Menlo, Consolas, monospace',
      theme: { background: '#0b0b0f', foreground: '#e4e4e7', cursor: '#a1a1aa' },
      cursorBlink: false,
      disableStdin: true,
      scrollback: 5000,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(container.current);
    termRef.current = term;
    const exec = platform.getExec();
    term.writeln(
      exec
        ? `\x1b[90mLAM-Code — ${exec.description}\x1b[0m`
        : `\x1b[33mExécution indisponible : ${platform.execUnavailableReason()}\x1b[0m`,
    );
    const detach = store.attachTerminal({ write: (data) => term.write(data) });
    const observer = new ResizeObserver(() => {
      try {
        fit.fit();
      } catch {
        term.refresh(0, term.rows - 1);
      }
    });
    observer.observe(container.current);
    return () => {
      observer.disconnect();
      detach();
      term.dispose();
    };
  }, [platform, store]);

  async function run() {
    const cmd = command.trim();
    const project = store.getState().project;
    if (!cmd || !project) return;
    const decision = checkCommand(cmd);
    if (!decision.allowed) {
      store.writeTerminal(toTerminal(`\n\x1b[31mCommande refusée : ${decision.reason}\x1b[0m\n`));
      return;
    }
    const exec = platform.getExec();
    if (!exec) {
      store.writeTerminal(toTerminal(`\n\x1b[33mExécution indisponible : ${platform.execUnavailableReason()}\x1b[0m\n`));
      return;
    }
    const controller = new AbortController();
    setRunning(controller);
    store.writeTerminal(toTerminal(`\n\x1b[36m$ ${cmd}\x1b[0m\n`));
    try {
      const result = await exec.run({
        cmd,
        cwd: '',
        project,
        files: store.vfs.snapshot(),
        timeoutMs: DEFAULT_TIMEOUT_MS,
        maxOutputBytes: MAX_OUTPUT_BYTES,
        signal: controller.signal,
        onOutput: (chunk) => store.writeTerminal(toTerminal(chunk)),
      });
      for (const file of result.changedFiles ?? []) {
        if (store.vfs.get(file.path)?.content !== file.content) store.vfs.write(file.path, file.content, 'system', file.encoding);
      }
      for (const path of result.removedPaths ?? []) if (store.vfs.exists(path)) store.vfs.remove(path, 'system');
      const color = result.exitCode === 0 ? '32' : '31';
      store.writeTerminal(toTerminal(`\n\x1b[${color}m[code ${result.exitCode} · ${result.durationMs} ms]\x1b[0m\n`));
      setCommand('');
    } catch (error) {
      store.writeTerminal(toTerminal(`\n\x1b[31m${error instanceof Error ? error.message : String(error)}\x1b[0m\n`));
    } finally {
      setRunning(null);
    }
  }

  return (
    <div className="flex h-full flex-col bg-[#0b0b0f]" data-testid="terminal">
      <div ref={container} className="min-h-0 flex-1 overflow-hidden px-2 pt-1" />
      <form
        className="flex items-center gap-1 border-t border-border p-1"
        onSubmit={(e) => {
          e.preventDefault();
          void run();
        }}
      >
        <span className="pl-1 font-mono text-xs text-muted-foreground">$</span>
        <input
          aria-label={t('terminal')}
          className="h-7 flex-1 bg-transparent font-mono text-xs outline-none"
          value={command}
          onChange={(e) => setCommand(e.target.value)}
          placeholder="npm install"
          disabled={running !== null}
        />
        {running ? (
          <Button type="button" size="icon" variant="ghost" title={t('stop')} onClick={() => running.abort()}>
            <Square />
          </Button>
        ) : (
          <Button type="submit" size="icon" variant="ghost" title="Exécuter" disabled={!command.trim()}>
            <Play />
          </Button>
        )}
        <Button type="button" size="icon" variant="ghost" title="Effacer" onClick={() => termRef.current?.clear()}>
          <Eraser />
        </Button>
      </form>
    </div>
  );
}
