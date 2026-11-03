import { useEffect, useState } from 'react';
import type { useCloudSync } from '@/hooks/useCloudSync';
import { Cloud, CloudOff, GitBranch, History, LogOut, RefreshCw } from 'lucide-react';
import { useApp } from '@/app/AppContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  cloudEnabled,
  createSnapshot,
  listSnapshots,
  restoreSnapshot,
  signIn,
  signInWithGitHub,
  signOut,
  signUp,
  type SnapshotRow,
} from '@/lib/cloud/supabase';

type Cloud = ReturnType<typeof useCloudSync>;

/** Bouton d'en-tête : connexion (e-mail / GitHub), synchronisation et snapshots. */
export function CloudButton({ cloud }: { cloud: Cloud }) {
  const { store } = useApp();
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [snapshots, setSnapshots] = useState<SnapshotRow[]>([]);
  const [label, setLabel] = useState('');
  const [busy, setBusy] = useState(false);
  const project = store.getState().project;

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setMessage(null);
    try {
      await action();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (!open || !cloud.session || !project?.remoteId) return;
    void listSnapshots(project.remoteId).then(setSnapshots).catch(() => setSnapshots([]));
  }, [open, cloud.session, project?.remoteId]);

  return (
    <>
      <Button size="sm" variant="ghost" onClick={() => setOpen(true)} title={cloud.status ?? 'Compte et synchronisation'} data-testid="cloud-button">
        {cloud.session ? <Cloud className="text-emerald-400" /> : <CloudOff />}
        <span className="hidden md:inline">{cloud.session ? cloud.session.user.email : 'Connexion'}</span>
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Compte et synchronisation</DialogTitle>
            <DialogDescription>
              Facultatif : sans compte, vos projets restent sur cet appareil. Connecté, ils sont synchronisés avec Supabase (clés API jamais envoyées).
            </DialogDescription>
          </DialogHeader>
          {!cloudEnabled ? (
            <p className="text-sm text-muted-foreground">
              Synchronisation non configurée sur cette installation (variables VITE_SUPABASE_URL et VITE_SUPABASE_ANON_KEY absentes au build).
            </p>
          ) : !cloud.session ? (
            <form
              className="space-y-3"
              onSubmit={(e) => {
                e.preventDefault();
                void run(() => signIn(email, password));
              }}
            >
              <div className="space-y-1">
                <Label htmlFor="email">E-mail</Label>
                <Input id="email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="password">Mot de passe</Label>
                <Input id="password" type="password" autoComplete="current-password" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} />
              </div>
              <div className="flex flex-wrap gap-2">
                <Button type="submit" disabled={busy}>
                  Se connecter
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      const signedIn = await signUp(email, password);
                      if (!signedIn) setMessage('Compte créé : confirmez votre e-mail puis connectez-vous.');
                    })
                  }
                >
                  Créer un compte
                </Button>
                <Button type="button" variant="outline" disabled={busy} onClick={() => void run(signInWithGitHub)}>
                  <GitBranch /> GitHub
                </Button>
              </div>
            </form>
          ) : (
            <div className="space-y-3 text-sm">
              <p>
                Connecté : <strong>{cloud.session.user.email}</strong>
              </p>
              {cloud.status && <p className="text-xs text-muted-foreground">{cloud.status}</p>}
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="secondary" disabled={busy} onClick={() => void run(async () => void (await cloud.syncNow()))}>
                  <RefreshCw /> Synchroniser
                </Button>
                <Button size="sm" variant="ghost" onClick={() => void run(signOut)}>
                  <LogOut /> Déconnexion
                </Button>
              </div>
              <div className="space-y-2 border-t border-border pt-3">
                <h4 className="flex items-center gap-1.5 font-semibold">
                  <History className="h-4 w-4" /> Snapshots
                </h4>
                <form
                  className="flex gap-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void run(async () => {
                      const remoteId = await cloud.syncNow();
                      if (!remoteId) throw new Error('Synchronisation impossible.');
                      const row = await createSnapshot(remoteId, store.vfs.snapshot(), label);
                      setSnapshots((s) => [row, ...s]);
                      setLabel('');
                    });
                  }}
                >
                  <Input aria-label="Nom du snapshot" placeholder="Nom (facultatif)" value={label} onChange={(e) => setLabel(e.target.value)} />
                  <Button size="sm" type="submit" disabled={busy}>
                    Créer
                  </Button>
                </form>
                <ul className="max-h-48 space-y-1 overflow-y-auto">
                  {snapshots.map((s) => (
                    <li key={s.id} className="flex items-center gap-2 rounded border border-border px-2 py-1 text-xs">
                      <span className="flex-1 truncate">
                        {s.label || 'Sans nom'} — {new Date(s.created_at).toLocaleString()} ({Math.round(s.size_bytes / 1024)} Ko)
                      </span>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busy}
                        onClick={() =>
                          window.confirm('Remplacer les fichiers du projet par ce snapshot ?') &&
                          void run(async () => {
                            await store.restoreFiles(await restoreSnapshot(s));
                            setMessage('Snapshot restauré.');
                          })
                        }
                      >
                        Restaurer
                      </Button>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          )}
          {message && (
            <p className="text-xs text-amber-300" role="status">
              {message}
            </p>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
