import { useCallback, useState, type ReactNode } from 'react';
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels';
import { Bot, Code2, Eye, FolderOpen, FolderTree, Settings as SettingsIcon, SquareTerminal } from 'lucide-react';
import { useApp, useStoreState } from '@/app/AppContext';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { FileTree } from '@/components/explorer/FileTree';
import { Dropzone } from '@/components/explorer/Dropzone';
import { ProjectList } from '@/components/explorer/ProjectList';
import { EditorPanel } from '@/components/editor/EditorPanel';
import { TerminalPanel } from '@/components/terminal/TerminalPanel';
import { LivePreview } from '@/components/preview/LivePreview';
import { ChatPanel } from '@/components/chat/ChatPanel';
import { SettingsDialog } from '@/components/settings/SettingsDialog';
import { useAgent, type PendingCall } from '@/hooks/useAgent';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import type { LamUIMessage } from '@/lib/agent/transport';
import { cn } from '@/lib/utils';

type MobileTab = 'files' | 'editor' | 'preview' | 'terminal' | 'chat';

function Handle({ vertical = false }: { vertical?: boolean }) {
  return (
    <PanelResizeHandle
      className={cn('bg-border transition-colors hover:bg-primary/60 data-[resize-handle-state=drag]:bg-primary', vertical ? 'h-px' : 'w-px')}
    />
  );
}

interface AppShellProps {
  headerExtra?: ReactNode;
  onMessagesSaved?: (projectId: string, messages: LamUIMessage[]) => void;
}

/** Coquille principale : 3 colonnes redimensionnables (desktop) ou onglets (mobile < 768 px). */
export function AppShell({ headerExtra, onMessagesSaved }: AppShellProps) {
  const { platform, store, t } = useApp();
  const project = useStoreState((s) => s.project);
  const error = useStoreState((s) => s.error);
  const loading = useStoreState((s) => s.loading);
  const agent = useAgent(onMessagesSaved);
  const mobile = useMediaQuery('(max-width: 767px)');
  const [tab, setTab] = useState<MobileTab>('chat');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [attachments, setAttachments] = useState<string[]>([]);
  const [uploadRequest, setUploadRequest] = useState<PendingCall | null>(null);

  const onUploaded = useCallback(
    (paths: string[]) => {
      if (uploadRequest) {
        agent.uploaded(uploadRequest, paths);
        setUploadRequest(null);
        if (mobile) setTab('chat');
      } else setAttachments((a) => [...new Set([...a, ...paths])]);
    },
    [agent, uploadRequest, mobile],
  );

  const onRequestUpload = useCallback(
    (call: PendingCall) => {
      setUploadRequest(call);
      if (mobile) setTab('files');
    },
    [mobile],
  );

  const exec = platform.getExec();
  const left = (
    <div className="flex h-full flex-col bg-sidebar">
      <FileTree />
      <Dropzone onUploaded={onUploaded} highlight={uploadRequest ? `${t('upload')} : ${String(uploadRequest.input.reason ?? '')}` : null} />
      <ProjectList />
    </div>
  );
  const chat = (
    <ChatPanel
      agent={agent}
      attachments={attachments}
      onClearAttachments={() => setAttachments([])}
      onRequestUpload={onRequestUpload}
      onOpenSettings={() => setSettingsOpen(true)}
    />
  );

  return (
    <div className="flex h-full flex-col bg-background text-foreground">
      <header className="flex h-10 shrink-0 items-center gap-2 border-b border-border bg-panel px-3">
        <Code2 className="h-4 w-4 text-primary" />
        <span className="text-sm font-semibold">LAM-Code</span>
        <span className="truncate text-xs text-muted-foreground">{loading ? '…' : project?.name}</span>
        <Badge variant={platform.badge === 'Local Environment' ? 'success' : 'secondary'} title={exec ? exec.description : platform.execUnavailableReason()} data-testid="env-badge">
          {platform.badge}
        </Badge>
        {!exec && <Badge variant="warning" title={platform.execUnavailableReason()}>exécution indisponible</Badge>}
        <span className="flex-1" />
        {platform.pickWorkspace && (
          <Button
            size="sm"
            variant="ghost"
            title={project?.workspacePath ?? t('chooseWorkspace')}
            onClick={async () => {
              const path = await platform.pickWorkspace?.();
              if (path) await store.setWorkspace(path);
            }}
          >
            <FolderOpen /> <span className="hidden max-w-48 truncate sm:inline">{project?.workspacePath ?? t('chooseWorkspace')}</span>
          </Button>
        )}
        {headerExtra}
        <Button size="icon" variant="ghost" title={t('settings')} aria-label={t('settings')} onClick={() => setSettingsOpen(true)}>
          <SettingsIcon />
        </Button>
      </header>
      {error && (
        <div className="flex items-center gap-2 border-b border-destructive/40 bg-destructive/10 px-3 py-1 text-xs text-red-300" role="alert">
          <span className="flex-1">{error}</span>
          <button onClick={() => store.clearError()} aria-label={t('close')}>×</button>
        </div>
      )}
      {mobile ? (
        <>
          <main className="relative min-h-0 flex-1">
            {(
              [
                ['files', left],
                ['editor', <EditorPanel key="e" />],
                ['preview', <LivePreview key="p" />],
                ['terminal', <TerminalPanel key="t" />],
                ['chat', chat],
              ] as const
            ).map(([id, node]) => (
              <section key={id} className={cn('absolute inset-0', tab !== id && 'invisible')} aria-hidden={tab !== id}>
                {node}
              </section>
            ))}
          </main>
          <nav className="grid h-14 shrink-0 grid-cols-5 border-t border-border bg-panel" aria-label="Navigation">
            {(
              [
                ['files', FolderTree, t('files')],
                ['editor', Code2, t('editor')],
                ['preview', Eye, t('preview')],
                ['terminal', SquareTerminal, t('terminal')],
                ['chat', Bot, t('chat')],
              ] as const
            ).map(([id, Icon, label]) => (
              <button
                key={id}
                className={cn('flex flex-col items-center justify-center gap-0.5 text-[11px]', tab === id ? 'text-primary' : 'text-muted-foreground')}
                onClick={() => setTab(id)}
                aria-current={tab === id}
              >
                <Icon className="h-5 w-5" />
                {label}
                {id === 'chat' && agent.pending.length > 0 && <span className="absolute mt-[-28px] ml-6 h-2 w-2 rounded-full bg-amber-400" />}
              </button>
            ))}
          </nav>
        </>
      ) : (
        <PanelGroup direction="horizontal" autoSaveId="lam-main" className="min-h-0 flex-1">
          <Panel defaultSize={18} minSize={12} maxSize={35}>
            {left}
          </Panel>
          <Handle />
          <Panel defaultSize={52} minSize={30}>
            <PanelGroup direction="vertical" autoSaveId="lam-center">
              <Panel defaultSize={68} minSize={20}>
                <PanelGroup direction="horizontal" autoSaveId="lam-editor">
                  <Panel defaultSize={55} minSize={20}>
                    <EditorPanel />
                  </Panel>
                  <Handle />
                  <Panel defaultSize={45} minSize={15}>
                    <LivePreview />
                  </Panel>
                </PanelGroup>
              </Panel>
              <Handle vertical />
              <Panel defaultSize={32} minSize={10}>
                <TerminalPanel />
              </Panel>
            </PanelGroup>
          </Panel>
          <Handle />
          <Panel defaultSize={30} minSize={20} maxSize={50}>
            {chat}
          </Panel>
        </PanelGroup>
      )}
      <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
    </div>
  );
}
