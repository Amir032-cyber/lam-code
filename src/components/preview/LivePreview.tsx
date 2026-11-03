import { useEffect, useMemo, useState } from 'react';
import { ExternalLink, RefreshCw } from 'lucide-react';
import { useApp, useStoreState, useVfsVersion } from '@/app/AppContext';
import { Button } from '@/components/ui/button';
import { buildStaticPreview } from '@/lib/preview';

/** Aperçu live dans un iframe sandboxé (serveur de dev détecté, sinon index.html statique). */
export function LivePreview() {
  const { store, platform, t } = useApp();
  const previewUrl = useStoreState((s) => s.previewUrl);
  const version = useVfsVersion();
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    const exec = platform.getExec();
    if (!exec?.onServerReady) return;
    return exec.onServerReady((url) => store.setPreviewUrl(url));
  }, [platform, store]);

  const staticDoc = useMemo(() => {
    void version;
    return previewUrl ? null : buildStaticPreview(store.vfs);
  }, [previewUrl, store, version]);

  return (
    <div className="flex h-full flex-col bg-background" data-testid="preview">
      <div className="flex h-8 items-center gap-1 border-b border-border px-2 text-xs text-muted-foreground">
        <span className="flex-1 truncate font-mono">{previewUrl ?? (staticDoc ? `${staticDoc.entry} (statique)` : '—')}</span>
        {previewUrl && (
          <Button size="icon" variant="ghost" title="Revenir à l’aperçu statique" onClick={() => store.setPreviewUrl(null)}>
            ×
          </Button>
        )}
        <Button size="icon" variant="ghost" title="Recharger" onClick={() => setNonce((n) => n + 1)}>
          <RefreshCw />
        </Button>
        {previewUrl && (
          <Button size="icon" variant="ghost" title="Ouvrir" asChild>
            <a href={previewUrl} target="_blank" rel="noreferrer">
              <ExternalLink />
            </a>
          </Button>
        )}
      </div>
      {previewUrl ? (
        <iframe
          key={`${previewUrl}-${nonce}`}
          title={t('preview')}
          src={previewUrl}
          className="min-h-0 flex-1 bg-white"
          sandbox="allow-scripts allow-forms allow-modals allow-same-origin allow-popups"
          allow="cross-origin-isolated"
        />
      ) : staticDoc ? (
        <iframe
          key={`static-${nonce}`}
          title={t('preview')}
          srcDoc={staticDoc.html}
          className="min-h-0 flex-1 bg-white"
          sandbox="allow-scripts allow-forms allow-modals"
        />
      ) : (
        <div className="flex flex-1 items-center justify-center p-6 text-center text-sm text-muted-foreground">
          {t('noPreview')}
        </div>
      )}
    </div>
  );
}
