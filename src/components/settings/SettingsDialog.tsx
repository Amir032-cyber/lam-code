import { useEffect, useState } from 'react';
import { generateText } from 'ai';
import { CheckCircle2, CircleAlert, Loader2 } from 'lucide-react';
import { useApp } from '@/app/AppContext';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { createModel, PROVIDER_IDS, PROVIDERS, type ProviderId } from '@/lib/agent/providers';
import { testSandbox } from '@/lib/sandbox/remote';
import { WebSecretStore } from '@/lib/platform/webSecrets';
import { SECRET_NAMES } from '@/lib/settings';

type TestState = { status: 'idle' | 'running' | 'ok' | 'error'; message?: string };

async function testKey(provider: ProviderId, model: string, key: string, apiMode: 'proxy' | 'direct', apiBaseUrl: string): Promise<string> {
  if (apiMode === 'direct') {
    const result = await generateText({ model: createModel(provider, model, key), prompt: 'Réponds uniquement « OK ».', maxOutputTokens: 5 });
    return result.text.trim() || 'OK';
  }
  const response = await fetch(`${apiBaseUrl.replace(/\/$/, '')}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(key ? { 'x-user-api-key': key } : {}) },
    body: JSON.stringify({
      provider,
      model,
      messages: [{ id: 'test', role: 'user', parts: [{ type: 'text', text: 'Réponds uniquement « OK ».' }] }],
      context: { platform: 'web', platformLabel: 'Test', sandboxDescription: 'test', canExec: false, language: 'fr', fileTree: '', uploads: [], projectName: 'test' },
    }),
  });
  if (!response.ok) {
    const data = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(data.error ?? `HTTP ${response.status}`);
  }
  const text = await response.text();
  const error = /"type":"error","errorText":"([^"]+)"/.exec(text)?.[1];
  if (error) throw new Error(error);
  return 'Le fournisseur a répondu.';
}

/** Réglages : clés API (stockage sécurisé), modèle, mode proxy/direct, sandbox, langue, thème. */
export function SettingsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { settings, updateSettings, platform, store, t } = useApp();
  const [keys, setKeys] = useState<Record<string, string>>({});
  const [stored, setStored] = useState<Record<string, boolean>>({});
  const [tests, setTests] = useState<Record<string, TestState>>({});
  const [passphrase, setPassphrase] = useState('');
  const [locked, setLocked] = useState(false);
  const [vaultMessage, setVaultMessage] = useState<string | null>(null);
  const webVault = platform.secrets instanceof WebSecretStore ? platform.secrets : null;
  const project = store.getState().project;

  useEffect(() => {
    if (!open) return;
    void (async () => {
      if (webVault) setLocked(await webVault.isLocked());
      const next: Record<string, boolean> = {};
      for (const name of SECRET_NAMES) next[name] = (await platform.secrets.get(name).catch(() => null)) !== null;
      setStored(next);
    })();
  }, [open, platform, webVault]);

  async function saveKey(name: string) {
    const value = keys[name]?.trim() ?? '';
    if (value) await platform.secrets.set(name, value);
    else await platform.secrets.remove(name);
    setStored((s) => ({ ...s, [name]: Boolean(value) }));
    setKeys((k) => ({ ...k, [name]: '' }));
  }

  async function runTest(provider: ProviderId) {
    setTests((s) => ({ ...s, [provider]: { status: 'running' } }));
    try {
      const key = keys[provider]?.trim() || (await platform.secrets.get(provider)) || '';
      if (!key && settings.apiMode === 'direct') throw new Error('Aucune clé saisie.');
      const message = await testKey(provider, settings.models[provider], key, settings.apiMode, settings.apiBaseUrl);
      setTests((s) => ({ ...s, [provider]: { status: 'ok', message } }));
    } catch (error) {
      setTests((s) => ({ ...s, [provider]: { status: 'error', message: error instanceof Error ? error.message : String(error) } }));
    }
  }

  async function runSandboxTest() {
    setTests((s) => ({ ...s, sandbox: { status: 'running' } }));
    try {
      const token = keys.sandbox?.trim() || (await platform.secrets.get('sandbox'));
      const message = await testSandbox(settings.sandboxUrl, token);
      setTests((s) => ({ ...s, sandbox: { status: 'ok', message } }));
    } catch (error) {
      setTests((s) => ({ ...s, sandbox: { status: 'error', message: error instanceof Error ? error.message : String(error) } }));
    }
  }

  const testView = (name: string) => {
    const state = tests[name];
    if (!state || state.status === 'idle') return null;
    if (state.status === 'running') return <Loader2 className="h-4 w-4 animate-spin" />;
    return (
      <span className={`flex items-center gap-1 text-xs ${state.status === 'ok' ? 'text-emerald-400' : 'text-red-400'}`} role="status">
        {state.status === 'ok' ? <CheckCircle2 className="h-3.5 w-3.5" /> : <CircleAlert className="h-3.5 w-3.5" />}
        {state.message}
      </span>
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t('settings')}</DialogTitle>
          <DialogDescription>
            Clés stockées : {platform.secrets.description}. Elles ne sont jamais envoyées à Supabase ni écrites dans les journaux.
          </DialogDescription>
        </DialogHeader>

        {webVault && locked && (
          <form
            className="flex items-end gap-2 rounded border border-amber-500/40 p-2"
            onSubmit={async (e) => {
              e.preventDefault();
              try {
                await webVault.unlock(passphrase);
                setLocked(false);
                setPassphrase('');
                setVaultMessage(null);
              } catch (error) {
                setVaultMessage(error instanceof Error ? error.message : String(error));
              }
            }}
          >
            <div className="flex-1 space-y-1">
              <Label htmlFor="unlock">Phrase de passe du coffre</Label>
              <Input id="unlock" type="password" value={passphrase} onChange={(e) => setPassphrase(e.target.value)} />
            </div>
            <Button type="submit">Déverrouiller</Button>
          </form>
        )}
        {vaultMessage && <p className="text-xs text-red-400">{vaultMessage}</p>}

        <section className="space-y-3">
          <h3 className="text-sm font-semibold">Fournisseur et modèle</h3>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label>Fournisseur</Label>
              <Select value={settings.provider} onValueChange={(v) => updateSettings({ provider: v as ProviderId })}>
                <SelectTrigger aria-label="Fournisseur">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PROVIDER_IDS.map((id) => (
                    <SelectItem key={id} value={id}>
                      {PROVIDERS[id].label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="model">Modèle</Label>
              <Input
                id="model"
                list="models"
                value={settings.models[settings.provider]}
                onChange={(e) => updateSettings({ models: { ...settings.models, [settings.provider]: e.target.value } })}
              />
              <datalist id="models">
                {PROVIDERS[settings.provider].models.map((m) => (
                  <option key={m} value={m} />
                ))}
              </datalist>
            </div>
          </div>
          <div className="flex items-center justify-between rounded border border-border p-2">
            <div>
              <p className="text-sm">Mode direct (BYOK)</p>
              <p className="text-xs text-muted-foreground">
                Désactivé : appels via le proxy /api/chat (clé serveur ou la vôtre en en-tête). Activé : appel direct au fournisseur depuis l’appareil.
              </p>
            </div>
            <Switch
              aria-label="Mode direct"
              checked={settings.apiMode === 'direct'}
              onCheckedChange={(checked) => updateSettings({ apiMode: checked ? 'direct' : 'proxy' })}
            />
          </div>
          {settings.apiMode === 'proxy' && (
            <div className="space-y-1">
              <Label htmlFor="apiBase">URL du proxy (vide = même origine)</Label>
              <Input
                id="apiBase"
                placeholder="https://lam-code.vercel.app"
                value={settings.apiBaseUrl}
                onChange={(e) => updateSettings({ apiBaseUrl: e.target.value })}
              />
            </div>
          )}
        </section>

        <section className="space-y-2">
          <h3 className="text-sm font-semibold">Clés API</h3>
          {PROVIDER_IDS.map((id) => (
            <div key={id} className="space-y-1">
              <Label htmlFor={`key-${id}`}>
                {PROVIDERS[id].label}{' '}
                <a className="text-xs text-primary underline" href={PROVIDERS[id].keyUrl} target="_blank" rel="noreferrer">
                  obtenir une clé
                </a>
                {stored[id] && <span className="ml-2 text-xs text-emerald-400">enregistrée</span>}
              </Label>
              <div className="flex flex-wrap items-center gap-2">
                <Input
                  id={`key-${id}`}
                  type="password"
                  autoComplete="off"
                  className="min-w-0 flex-1"
                  placeholder={stored[id] ? '•••••••• (laisser vide et enregistrer pour supprimer)' : 'Collez votre clé'}
                  value={keys[id] ?? ''}
                  onChange={(e) => setKeys((k) => ({ ...k, [id]: e.target.value }))}
                />
                <Button size="sm" variant="secondary" onClick={() => void saveKey(id)} disabled={locked}>
                  {t('save')}
                </Button>
                <Button size="sm" variant="outline" onClick={() => void runTest(id)} disabled={locked}>
                  {t('test')}
                </Button>
              </div>
              {testView(id)}
            </div>
          ))}
        </section>

        <section className="space-y-2">
          <h3 className="text-sm font-semibold">Sandbox distant {platform.id === 'mobile' ? '(requis pour exécuter du code sur Android)' : '(facultatif)'}</h3>
          <Input
            aria-label="URL du sandbox"
            placeholder="https://sandbox.example.com"
            value={settings.sandboxUrl}
            onChange={(e) => updateSettings({ sandboxUrl: e.target.value })}
          />
          <div className="flex flex-wrap items-center gap-2">
            <Input
              type="password"
              aria-label="Jeton du sandbox"
              className="min-w-0 flex-1"
              placeholder={stored.sandbox ? '•••••••• jeton enregistré' : 'Jeton (facultatif)'}
              value={keys.sandbox ?? ''}
              onChange={(e) => setKeys((k) => ({ ...k, sandbox: e.target.value }))}
            />
            <Button size="sm" variant="secondary" onClick={() => void saveKey('sandbox')} disabled={locked}>
              {t('save')}
            </Button>
            <Button size="sm" variant="outline" onClick={() => void runSandboxTest()} disabled={!settings.sandboxUrl}>
              {t('test')}
            </Button>
          </div>
          {testView('sandbox')}
        </section>

        <section className="space-y-2">
          <h3 className="text-sm font-semibold">Sécurité</h3>
          <div className="flex items-center justify-between rounded border border-border p-2">
            <div>
              <p className="text-sm">Approuver automatiquement écritures et commandes</p>
              <p className="text-xs text-muted-foreground">Par défaut, chaque write_file et run_command demande votre accord.</p>
            </div>
            <Switch
              aria-label="Approbation automatique"
              checked={settings.approval === 'auto'}
              onCheckedChange={(checked) => updateSettings({ approval: checked ? 'auto' : 'ask' })}
            />
          </div>
          {project && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                localStorage.removeItem(`lam:allow:${project.id}`);
                setVaultMessage('Autorisations « toujours autoriser » du projet réinitialisées (effectif au prochain chargement du projet).');
              }}
            >
              Réinitialiser « toujours autoriser » pour ce projet
            </Button>
          )}
          {webVault && !locked && (
            <form
              className="flex flex-wrap items-end gap-2"
              onSubmit={async (e) => {
                e.preventDefault();
                await webVault.setPassphrase(passphrase || null, [...SECRET_NAMES]);
                setVaultMessage(passphrase ? 'Coffre protégé par phrase de passe.' : 'Phrase de passe retirée.');
                setPassphrase('');
              }}
            >
              <div className="min-w-0 flex-1 space-y-1">
                <Label htmlFor="pass">Phrase de passe du coffre (facultative)</Label>
                <Input id="pass" type="password" value={passphrase} onChange={(e) => setPassphrase(e.target.value)} />
              </div>
              <Button type="submit" variant="secondary">
                {passphrase ? 'Protéger' : 'Retirer la phrase de passe'}
              </Button>
            </form>
          )}
        </section>

        <section className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <Label>Langue</Label>
            <Select value={settings.language} onValueChange={(v) => updateSettings({ language: v as 'fr' | 'en' })}>
              <SelectTrigger aria-label="Langue">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="fr">Français</SelectItem>
                <SelectItem value="en">English</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label>Thème</Label>
            <Select value={settings.theme} onValueChange={(v) => updateSettings({ theme: v as 'dark' | 'light' })}>
              <SelectTrigger aria-label="Thème">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="dark">Sombre</SelectItem>
                <SelectItem value="light">Clair</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </section>
      </DialogContent>
    </Dialog>
  );
}
