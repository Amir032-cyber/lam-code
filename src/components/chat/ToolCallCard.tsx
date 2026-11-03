import { useState } from 'react';
import { CheckCircle2, ChevronDown, ChevronRight, CircleAlert, FileText, FolderTree, Loader2, MessageCircleQuestion, Pencil, Terminal, Upload, Wrench, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import type { PendingCall } from '@/hooks/useAgent';
import type { AgentToolName } from '@/lib/agent/toolDefs';
import type { MessageKey } from '@/lib/i18n';

export interface ToolCallView {
  toolCallId: string;
  tool: AgentToolName;
  state: string;
  input: Record<string, unknown> | undefined;
  output?: unknown;
  errorText?: string;
}

interface Props {
  call: ToolCallView;
  pending?: PendingCall;
  busy: boolean;
  t: (key: MessageKey) => string;
  onApprove: (call: PendingCall, edited?: Record<string, unknown>, always?: boolean) => void;
  onReject: (call: PendingCall) => void;
  onAnswer: (call: PendingCall, answer: string) => void;
  onRequestUpload: (call: PendingCall) => void;
}

const ICONS: Record<AgentToolName, typeof Wrench> = {
  read_file: FileText,
  write_file: Pencil,
  list_files: FolderTree,
  run_command: Terminal,
  ask_user: MessageCircleQuestion,
  request_file_upload: Upload,
};

function summary(call: ToolCallView): string {
  const input = call.input ?? {};
  switch (call.tool) {
    case 'read_file':
    case 'write_file':
      return String(input.path ?? '');
    case 'list_files':
      return String(input.path ?? '.');
    case 'run_command':
      return String(input.cmd ?? '');
    case 'ask_user':
      return String(input.question ?? '');
    case 'request_file_upload':
      return String(input.reason ?? '');
  }
}

function pretty(value: unknown): string {
  if (typeof value === 'string') return value;
  return JSON.stringify(value, null, 2);
}

/** Carte d'appel d'outil : paramètres, statut, résultat et actions d'approbation. */
export function ToolCallCard({ call, pending, busy, t, onApprove, onReject, onAnswer, onRequestUpload }: Props) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [answer, setAnswer] = useState('');
  const [always, setAlways] = useState(false);
  const Icon = ICONS[call.tool] ?? Wrench;
  const output = call.output as { exitCode?: number } | undefined;
  const failed = call.state === 'output-error' || (typeof output?.exitCode === 'number' && output.exitCode !== 0);
  const done = call.state === 'output-available' || call.state === 'output-error';
  const editableField = call.tool === 'write_file' ? 'content' : call.tool === 'run_command' ? 'cmd' : null;

  return (
    <div className="my-1.5 rounded-md border border-border bg-card text-xs" data-testid="tool-card" data-tool={call.tool} data-state={call.state}>
      <button className="flex w-full items-center gap-2 px-2 py-1.5 text-left" onClick={() => setOpen(!open)}>
        {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
        <Icon className="h-3.5 w-3.5 text-sky-400" />
        <span className="font-mono font-medium">{call.tool}</span>
        <span className="flex-1 truncate font-mono text-muted-foreground">{summary(call)}</span>
        {busy || call.state === 'input-streaming' ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : done ? (
          failed ? <CircleAlert className="h-3.5 w-3.5 text-red-400" /> : <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
        ) : pending ? (
          <Badge variant="warning">{t('toolCall')}</Badge>
        ) : null}
      </button>
      {open && (
        <div className="space-y-2 border-t border-border p-2">
          <pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded bg-muted/50 p-2 font-mono">{pretty(call.input ?? {})}</pre>
          {call.state === 'output-available' && (
            <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded bg-muted/50 p-2 font-mono">{pretty(call.output)}</pre>
          )}
          {call.errorText && <p className="rounded bg-destructive/20 p-2 text-red-300">{call.errorText}</p>}
        </div>
      )}
      {pending && !busy && (pending.tool === 'write_file' || pending.tool === 'run_command') && (
        <div className="space-y-2 border-t border-border p-2" data-testid="approval">
          {editing && editableField && (
            <Textarea
              aria-label={t('edit')}
              className="min-h-[120px] font-mono text-xs"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
            />
          )}
          <label className="flex items-center gap-1.5 text-muted-foreground">
            <input type="checkbox" checked={always} onChange={(e) => setAlways(e.target.checked)} />
            {t('alwaysAllow')}
          </label>
          <div className="flex flex-wrap gap-1.5">
            <Button
              size="sm"
              onClick={() => onApprove(pending, editing && editableField ? { ...pending.input, [editableField]: draft } : undefined, always)}
            >
              <CheckCircle2 /> {t('approve')}
            </Button>
            {editableField && !editing && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setDraft(String(pending.input[editableField] ?? ''));
                  setEditing(true);
                  setOpen(true);
                }}
              >
                <Pencil /> {t('edit')}
              </Button>
            )}
            <Button size="sm" variant="ghost" onClick={() => onReject(pending)}>
              <X /> {t('cancel')}
            </Button>
          </div>
        </div>
      )}
      {pending && pending.tool === 'ask_user' && (
        <div className="space-y-2 border-t border-border p-2" data-testid="ask-user">
          <p className="text-sm text-foreground">{String(pending.input.question ?? '')}</p>
          {Array.isArray(pending.input.options) && (
            <div className="flex flex-wrap gap-1.5">
              {(pending.input.options as string[]).map((option) => (
                <Button key={option} size="sm" variant="secondary" onClick={() => onAnswer(pending, option)}>
                  {option}
                </Button>
              ))}
            </div>
          )}
          <form
            className="flex gap-1.5"
            onSubmit={(e) => {
              e.preventDefault();
              if (answer.trim()) onAnswer(pending, answer.trim());
            }}
          >
            <input
              aria-label={t('answer')}
              className="h-8 flex-1 rounded border border-input bg-transparent px-2 text-xs outline-none"
              value={answer}
              onChange={(e) => setAnswer(e.target.value)}
            />
            <Button size="sm" type="submit">
              {t('answer')}
            </Button>
          </form>
        </div>
      )}
      {pending && pending.tool === 'request_file_upload' && (
        <div className="flex flex-wrap items-center gap-1.5 border-t border-border p-2">
          <span className="flex-1 text-muted-foreground">{String(pending.input.reason ?? '')}</span>
          <Button size="sm" onClick={() => onRequestUpload(pending)}>
            <Upload /> {t('upload')}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => onReject(pending)}>
            <X /> {t('cancel')}
          </Button>
        </div>
      )}
    </div>
  );
}
