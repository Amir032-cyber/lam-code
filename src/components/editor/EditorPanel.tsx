import { useEffect } from 'react';
import Editor from '@monaco-editor/react';
import { FileCode2, X } from 'lucide-react';
import './monacoSetup';
import { useApp, useStoreState, useVfsVersion } from '@/app/AppContext';
import { basename, languageFromPath } from '@/lib/fs/paths';
import { cn } from '@/lib/utils';

/** Éditeur Monaco multi-onglets : coloration, Ctrl+S, marqueur de fichier modifié. */
export function EditorPanel() {
  const { store, settings, t } = useApp();
  const openTabs = useStoreState((s) => s.openTabs);
  const activeFile = useStoreState((s) => s.activeFile);
  const dirty = useStoreState((s) => s.dirty);
  const flash = useStoreState((s) => s.flash);
  useVfsVersion();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        const current = store.getState().activeFile;
        if (current) store.saveFile(current);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [store]);

  const file = activeFile ? store.vfs.get(activeFile) : undefined;
  const value = activeFile ? (dirty[activeFile] ?? file?.content ?? '') : '';
  const binary = file?.encoding === 'base64';

  return (
    <div className="flex h-full flex-col bg-background" data-testid="editor">
      <div className="flex h-9 shrink-0 items-stretch overflow-x-auto border-b border-border bg-panel" role="tablist">
        {openTabs.map((path) => (
          <div
            key={path}
            role="tab"
            aria-selected={path === activeFile}
            className={cn(
              'group flex cursor-pointer items-center gap-1.5 border-r border-border px-3 text-xs',
              path === activeFile ? 'bg-background text-foreground' : 'text-muted-foreground hover:bg-accent/50',
              flash[path] && Date.now() - flash[path]! < 2000 && 'animate-flash',
            )}
            onClick={() => store.openFile(path)}
            title={path}
          >
            <FileCode2 className="h-3.5 w-3.5" />
            <span>{basename(path)}</span>
            {dirty[path] !== undefined && <span className="h-2 w-2 rounded-full bg-primary" aria-label="modifié" />}
            <button
              className="rounded p-0.5 opacity-60 hover:bg-accent hover:opacity-100"
              aria-label={`${t('close')} ${basename(path)}`}
              onClick={(e) => {
                e.stopPropagation();
                store.closeFile(path);
              }}
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        ))}
      </div>
      <div className="min-h-0 flex-1">
        {!activeFile || !file ? (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">{t('noFileOpen')}</div>
        ) : binary ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 p-4 text-sm text-muted-foreground">
            {file.mime.startsWith('image/') ? (
              <img src={`data:${file.mime};base64,${file.content}`} alt={file.path} className="max-h-[70%] max-w-full rounded border" />
            ) : null}
            <span>
              {file.path} — {file.mime}, {file.size} o
            </span>
          </div>
        ) : (
          <Editor
            path={activeFile}
            value={value}
            language={languageFromPath(activeFile)}
            theme={settings.theme === 'dark' ? 'vs-dark' : 'vs'}
            onChange={(next) => store.editBuffer(activeFile, next ?? '')}
            options={{
              minimap: { enabled: false },
              fontSize: 13,
              automaticLayout: true,
              scrollBeyondLastLine: false,
              wordWrap: 'on',
              tabSize: 2,
            }}
          />
        )}
      </div>
    </div>
  );
}
