import { useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import { getToolName, isToolUIPart } from 'ai';
import { Brain, Paperclip, Send, Square, Trash2 } from 'lucide-react';
import { useApp } from '@/app/AppContext';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import type { AgentApi, PendingCall } from '@/hooks/useAgent';
import { MAX_STEPS } from '@/lib/agent/policy';
import { PROVIDERS } from '@/lib/agent/providers';
import type { AgentToolName } from '@/lib/agent/toolDefs';
import { ToolCallCard } from './ToolCallCard';

const THOUGHT = /^\s*(Réflexion|Reflection|Thought)\s*:\s*/i;

function Thought({ text, label }: { text: string; label: string }) {
  const [open, setOpen] = useState(false);
  return (
    <button
      className="my-1 flex w-full items-start gap-1.5 rounded border border-border/60 bg-muted/30 px-2 py-1 text-left text-xs italic text-muted-foreground"
      onClick={() => setOpen(!open)}
      data-testid="thought"
    >
      <Brain className="mt-0.5 h-3.5 w-3.5 shrink-0" />
      <span className={open ? 'whitespace-pre-wrap' : 'line-clamp-2'}>
        <strong className="not-italic">{label} : </strong>
        {text}
      </span>
    </button>
  );
}

function TextBlock({ text, thinkingLabel }: { text: string; thinkingLabel: string }) {
  const blocks: { thought: boolean; text: string }[] = [];
  for (const line of text.split('\n')) {
    const thought = THOUGHT.test(line);
    const content = thought ? line.replace(THOUGHT, '') : line;
    const last = blocks.at(-1);
    if (last && last.thought === thought && !thought) last.text += `\n${content}`;
    else blocks.push({ thought, text: content });
  }
  return (
    <>
      {blocks.map((b, i) =>
        b.thought ? (
          <Thought key={i} text={b.text} label={thinkingLabel} />
        ) : b.text.trim() ? (
          <div key={i} className="markdown text-sm">
            <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]}>
              {b.text}
            </ReactMarkdown>
          </div>
        ) : null,
      )}
    </>
  );
}

interface ChatPanelProps {
  agent: AgentApi;
  attachments: string[];
  onClearAttachments: () => void;
  onRequestUpload: (call: PendingCall) => void;
  onOpenSettings: () => void;
}

/** Panneau de chat : messages Markdown, réflexions, cartes d'outils, saisie et arrêt. */
export function ChatPanel({ agent, attachments, onClearAttachments, onRequestUpload, onOpenSettings }: ChatPanelProps) {
  const { settings, t } = useApp();
  const [input, setInput] = useState('');
  const bottom = useRef<HTMLDivElement>(null);
  const busy = agent.status === 'streaming' || agent.status === 'submitted' || agent.busyTools.length > 0;
  const pendingById = new Map(agent.pending.map((p) => [p.toolCallId, p]));

  useEffect(() => {
    bottom.current?.scrollIntoView({ block: 'end' });
  }, [agent.messages, agent.pending.length]);

  function submit() {
    const text = input.trim();
    if (!text || busy) return;
    void agent.send(text, attachments);
    setInput('');
    onClearAttachments();
  }

  return (
    <div className="flex h-full flex-col bg-sidebar" data-testid="chat">
      <div className="flex h-9 shrink-0 items-center gap-2 border-b border-border px-3 text-xs">
        <span className="font-semibold">{t('chat')}</span>
        <button className="truncate text-muted-foreground hover:text-foreground" onClick={onOpenSettings}>
          {PROVIDERS[settings.provider].label} · {settings.models[settings.provider]} · {settings.apiMode === 'proxy' ? 'proxy' : 'direct'}
        </button>
        <span className="flex-1" />
        {agent.steps > 0 && (
          <Badge variant="outline" title={t('steps')}>
            {agent.steps}/{MAX_STEPS}
          </Badge>
        )}
        <Button size="icon" variant="ghost" title={t('newChat')} aria-label={t('newChat')} onClick={agent.clear} disabled={busy}>
          <Trash2 />
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2" data-testid="messages">
        {agent.messages.length === 0 && (
          <p className="py-8 text-center text-sm text-muted-foreground">{t('placeholderPrompt')}</p>
        )}
        {agent.messages.map((message) => (
          <div key={message.id} className={message.role === 'user' ? 'my-2 flex justify-end' : 'my-2'} data-role={message.role}>
            <div className={message.role === 'user' ? 'max-w-[85%] rounded-lg bg-primary/15 px-3 py-2 text-sm' : 'w-full'}>
              {message.parts.map((part, index) => {
                if (part.type === 'text') {
                  return message.role === 'user' ? (
                    <p key={index} className="whitespace-pre-wrap">{part.text}</p>
                  ) : (
                    <TextBlock key={index} text={part.text} thinkingLabel={t('thinking')} />
                  );
                }
                if (part.type === 'reasoning') return <Thought key={index} text={part.text} label={t('thinking')} />;
                if (part.type === 'file') return <Badge key={index} variant="secondary">{part.filename ?? part.mediaType}</Badge>;
                if (isToolUIPart(part)) {
                  return (
                    <ToolCallCard
                      key={part.toolCallId}
                      call={{
                        toolCallId: part.toolCallId,
                        tool: getToolName(part) as AgentToolName,
                        state: part.state,
                        input: part.input as Record<string, unknown> | undefined,
                        output: part.state === 'output-available' ? part.output : undefined,
                        errorText: part.state === 'output-error' ? part.errorText : undefined,
                      }}
                      pending={pendingById.get(part.toolCallId)}
                      busy={agent.busyTools.includes(part.toolCallId)}
                      t={t}
                      onApprove={agent.approve}
                      onReject={(call) => agent.reject(call)}
                      onAnswer={agent.answer}
                      onRequestUpload={onRequestUpload}
                    />
                  );
                }
                return null;
              })}
            </div>
          </div>
        ))}
        {agent.error && (
          <div className="my-2 rounded border border-destructive/50 bg-destructive/10 p-2 text-xs text-red-300" role="alert">
            {agent.error.message}
            <div className="mt-1 flex gap-2">
              <Button size="sm" variant="outline" onClick={onOpenSettings}>
                {t('settings')}
              </Button>
              <Button size="sm" variant="ghost" onClick={agent.clearError}>
                {t('close')}
              </Button>
            </div>
          </div>
        )}
        <div ref={bottom} />
      </div>
      <div className="border-t border-border p-2">
        {attachments.length > 0 && (
          <div className="mb-1 flex flex-wrap gap-1">
            {attachments.map((a) => (
              <Badge key={a} variant="secondary">
                <Paperclip className="h-3 w-3" /> {a}
              </Badge>
            ))}
          </div>
        )}
        <div className="flex items-end gap-1.5">
          <Textarea
            aria-label={t('placeholderPrompt')}
            className="max-h-40 min-h-[44px] resize-none text-sm"
            placeholder={t('placeholderPrompt')}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                submit();
              }
            }}
          />
          {busy ? (
            <Button size="icon" variant="destructive" title={t('stop')} aria-label={t('stop')} onClick={agent.stop}>
              <Square />
            </Button>
          ) : (
            <Button size="icon" title={t('send')} aria-label={t('send')} onClick={submit} disabled={!input.trim()}>
              <Send />
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
