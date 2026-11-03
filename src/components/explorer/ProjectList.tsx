import { useState } from 'react';
import { FolderOpen, Plus, Trash2 } from 'lucide-react';
import { useApp, useStoreState } from '@/app/AppContext';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/** Projets récents (IndexedDB / Supabase) avec création et suppression. */
export function ProjectList() {
  const { store, platform, t } = useApp();
  const projects = useStoreState((s) => s.projects);
  const current = useStoreState((s) => s.project);
  const [name, setName] = useState('');
  const [creating, setCreating] = useState(false);

  async function create() {
    let workspace: string | undefined;
    if (platform.pickWorkspace) workspace = (await platform.pickWorkspace()) ?? undefined;
    await store.createProject(name || 'Nouveau projet', workspace);
    setName('');
    setCreating(false);
  }

  return (
    <div className="border-t border-border" data-testid="project-list">
      <div className="flex items-center justify-between px-2 py-1">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t('projects')}</span>
        <Button size="icon" variant="ghost" title={t('newProject')} aria-label={t('newProject')} onClick={() => setCreating(true)}>
          <Plus />
        </Button>
      </div>
      {creating && (
        <form
          className="flex gap-1 px-2 pb-1"
          onSubmit={(e) => {
            e.preventDefault();
            void create();
          }}
        >
          <input
            autoFocus
            aria-label={t('newProject')}
            className="h-7 flex-1 rounded border border-input bg-transparent px-2 text-xs outline-none"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t('newProject')}
          />
          <Button size="sm" type="submit">
            OK
          </Button>
        </form>
      )}
      <ul className="max-h-40 overflow-y-auto px-1 pb-2">
        {projects.map((p) => (
          <li key={p.id} className="group flex items-center">
            <button
              className={cn(
                'flex flex-1 items-center gap-1.5 truncate rounded px-2 py-1 text-left text-xs hover:bg-accent/60',
                current?.id === p.id && 'bg-accent text-accent-foreground',
              )}
              onClick={() => void store.openProject(p)}
              title={p.workspacePath ?? p.name}
            >
              <FolderOpen className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">{p.name}</span>
            </button>
            <button
              className="hidden rounded p-1 text-muted-foreground hover:text-red-400 group-hover:block"
              aria-label={`${t('delete')} ${p.name}`}
              onClick={() => window.confirm(t('confirmDelete', { name: p.name })) && void store.deleteProject(p.id)}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
