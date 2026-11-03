import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useChat } from '@ai-sdk/react';
import { getToolName, isToolUIPart, lastAssistantMessageIsCompleteWithToolCalls, type FileUIPart } from 'ai';
import { useApp } from '@/app/AppContext';
import { LamTransport, countSteps, type LamUIMessage } from '@/lib/agent/transport';
import { executeTool, isExecutableTool, type ToolDeps } from '@/lib/agent/tools';
import { FailureTracker, MAX_STEPS } from '@/lib/agent/policy';
import { APPROVAL_TOOLS, type AgentToolName } from '@/lib/agent/toolDefs';
import { PROVIDERS } from '@/lib/agent/providers';
import { loadAllowed, saveAllowed, type AllowedTools } from '@/lib/settings';
import { chatKey, kvGet, kvSet } from '@/lib/fs/persist';
import { extractText } from '@/lib/ingest/extract';

export interface PendingCall {
  toolCallId: string;
  tool: AgentToolName;
  input: Record<string, unknown>;
}


export function toTerminal(text: string): string {
  return text.replace(/\r?\n/g, '\r\n');
}

export function useAgent(onMessagesSaved?: (projectId: string, messages: LamUIMessage[]) => void) {
  const { store, platform, settings } = useApp();
  const projectId = store.getState().project?.id ?? 'none';
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const failures = useRef(new FailureTracker());
  const running = useRef(new Set<string>());
  const abortRef = useRef(new AbortController());
  const stoppedRef = useRef(false);
  const [allowed, setAllowed] = useState<AllowedTools>(() => loadAllowed(projectId));
  const allowedRef = useRef(allowed);
  allowedRef.current = allowed;
  const [busyTools, setBusyTools] = useState<string[]>([]);
  const [loadedFor, setLoadedFor] = useState<string | null>(null);

  const transport = useMemo(
    () =>
      new LamTransport({
        getSettings: () => {
          const s = settingsRef.current;
          return { provider: s.provider, model: s.models[s.provider], apiMode: s.apiMode, apiBaseUrl: s.apiBaseUrl };
        },
        getKey: (provider) => platform.secrets.get(provider).catch(() => null),
        getContext: () => {
          const state = store.getState();
          const exec = platform.getExec();
          return {
            platform: platform.id,
            platformLabel: platform.label,
            sandboxDescription: exec ? exec.description : platform.execUnavailableReason(),
            canExec: exec !== null,
            language: settingsRef.current.language,
            fileTree: store.vfs.tree('', 4).slice(0, 40_000),
            uploads: store.vfs.listFiles('uploads').map((f) => `${f.path} (${f.mime}, ${f.size} o)`),
            projectName: state.project?.name ?? 'Projet',
          };
        },
      }),
    [platform, store],
  );

  const deps = useCallback(
    (): ToolDeps => ({
      vfs: store.vfs,
      platform,
      project: store.getState().project!,
      failures: failures.current,
      signal: abortRef.current.signal,
      onOutput: (chunk) => store.writeTerminal(toTerminal(chunk)),
      onCommandStart: (cmd, cwd) => store.writeTerminal(toTerminal(`\n\x1b[36m${cwd ? `${cwd} ` : ''}$ ${cmd}\x1b[0m\n`)),
      extractText: async (path) => extractText(store.vfs.read(path)),
    }),
    [platform, store],
  );

  const chat = useChat<LamUIMessage>({
    id: projectId,
    transport,
    sendAutomaticallyWhen: ({ messages }) => {
      if (stoppedRef.current) return false;
      if (countSteps(messages.at(-1)) >= MAX_STEPS) return false;
      return lastAssistantMessageIsCompleteWithToolCalls({ messages });
    },
    onToolCall: ({ toolCall }) => {
      if (toolCall.dynamic) return;
      const name = toolCall.toolName as AgentToolName;
      const needsApproval = APPROVAL_TOOLS.includes(name);
      const autoApproved =
        settingsRef.current.approval === 'auto' || allowedRef.current[name as 'write_file' | 'run_command'] === true;
      if (isExecutableTool(name) && (!needsApproval || autoApproved)) {
        void runTool(toolCall.toolCallId, name, toolCall.input);
      }
    },
  });

  const { addToolOutput, setMessages, messages, status } = chat;

  async function runTool(toolCallId: string, name: AgentToolName, input: unknown, editedByUser = false) {
    if (!isExecutableTool(name) || running.current.has(toolCallId)) return;
    running.current.add(toolCallId);
    setBusyTools([...running.current]);
    try {
      const output = await executeTool(name, input, deps());
      void addToolOutput({
        tool: name,
        toolCallId,
        output: (editedByUser ? { ...(output as object), editedByUser: true, input } : output) as never,
      });
    } catch (error) {
      void addToolOutput({
        tool: name,
        toolCallId,
        state: 'output-error',
        errorText: error instanceof Error ? error.message : String(error),
      });
    } finally {
      running.current.delete(toolCallId);
      setBusyTools([...running.current]);
    }
  }

  useEffect(() => {
    setAllowed(loadAllowed(projectId));
    let cancelled = false;
    void kvGet<LamUIMessage[]>(chatKey(projectId)).then((saved) => {
      if (cancelled) return;
      setMessages(saved ?? []);
      setLoadedFor(projectId);
    });
    return () => {
      cancelled = true;
    };
  }, [projectId, setMessages]);

  useEffect(() => {
    if (loadedFor !== projectId || status === 'streaming' || status === 'submitted') return;
    void kvSet(chatKey(projectId), messages);
    onMessagesSaved?.(projectId, messages);
  }, [messages, status, projectId, loadedFor, onMessagesSaved]);

  const pending: PendingCall[] = useMemo(() => {
    const last = messages.at(-1);
    if (!last || last.role !== 'assistant') return [];
    const calls: PendingCall[] = [];
    for (const part of last.parts) {
      if (!isToolUIPart(part) || part.state !== 'input-available') continue;
      if (busyTools.includes(part.toolCallId)) continue;
      const tool = getToolName(part) as AgentToolName;
      if (tool === 'read_file' || tool === 'list_files') continue;
      calls.push({ toolCallId: part.toolCallId, tool, input: (part.input ?? {}) as Record<string, unknown> });
    }
    return calls;
  }, [messages, busyTools]);

  const send = useCallback(
    async (text: string, attachments: string[] = []) => {
      stoppedRef.current = false;
      failures.current.reset();
      abortRef.current = new AbortController();
      const s = settingsRef.current;
      const multimodal = PROVIDERS[s.provider].multimodal(s.models[s.provider]);
      const files: FileUIPart[] = [];
      if (multimodal) {
        for (const path of attachments) {
          const file = store.vfs.get(path);
          if (file && file.mime.startsWith('image/') && file.encoding === 'base64' && file.size < 3_000_000) {
            files.push({ type: 'file', mediaType: file.mime, filename: path, url: `data:${file.mime};base64,${file.content}` });
          }
        }
      }
      const note = attachments.length ? `\n\n[Fichiers joints : ${attachments.join(', ')}]` : '';
      await chat.sendMessage({ text: text + note, files });
    },
    [chat, store],
  );

  const approve = useCallback(
    (call: PendingCall, editedInput?: Record<string, unknown>, always = false) => {
      if (always && (call.tool === 'write_file' || call.tool === 'run_command')) {
        const next = { ...allowedRef.current, [call.tool]: true };
        saveAllowed(projectId, next);
        setAllowed(next);
      }
      void runTool(call.toolCallId, call.tool, editedInput ?? call.input, editedInput !== undefined);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [projectId, deps],
  );

  const reject = useCallback(
    (call: PendingCall, reason = 'Action refusée par l’utilisateur.') => {
      void addToolOutput({ tool: call.tool, toolCallId: call.toolCallId, state: 'output-error', errorText: reason });
    },
    [addToolOutput],
  );

  const answer = useCallback(
    (call: PendingCall, value: string) => {
      void addToolOutput({ tool: 'ask_user', toolCallId: call.toolCallId, output: { answer: value } as never });
    },
    [addToolOutput],
  );

  const uploaded = useCallback(
    (call: PendingCall, paths: string[]) => {
      void addToolOutput({
        tool: 'request_file_upload',
        toolCallId: call.toolCallId,
        output: { uploaded: paths, hint: 'Lis ces fichiers avec read_file.' } as never,
      });
    },
    [addToolOutput],
  );

  const stop = useCallback(() => {
    stoppedRef.current = true;
    abortRef.current.abort();
    void chat.stop();
    for (const call of pending) {
      void addToolOutput({ tool: call.tool, toolCallId: call.toolCallId, state: 'output-error', errorText: 'Arrêté par l’utilisateur.' });
    }
  }, [chat, pending, addToolOutput]);

  const clear = useCallback(() => {
    stoppedRef.current = true;
    setMessages([]);
    void kvSet(chatKey(projectId), []);
  }, [projectId, setMessages]);

  const revokeAllowed = useCallback(() => {
    saveAllowed(projectId, {});
    setAllowed({});
  }, [projectId]);

  return {
    messages,
    status,
    error: chat.error,
    clearError: chat.clearError,
    pending,
    busyTools,
    allowed,
    steps: countSteps(messages.at(-1)),
    send,
    approve,
    reject,
    answer,
    uploaded,
    stop,
    clear,
    revokeAllowed,
  };
}

export type AgentApi = ReturnType<typeof useAgent>;
