import { useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, File, FilePlus, Folder, FolderPlus, Pencil, Trash2 } from 'lucide-react';
import { useApp, useStoreState, useVfsVersion } from '@/app/AppContext';
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger } from '@/components/ui/context-menu';
import { Button } from '@/components/ui/button';
import { basename, dirname, joinPath } from '@/lib/fs/paths';
import { cn } from '@/lib/utils';

interface Node {
  path: string;
  name: string;
  dir: boolean;
  children: Node[];
}

function buildTree(files: string[], dirs: string[]): Node[] {
  const root: Node = { path: '', name: '', dir: true, children: [] };
  const index = new Map<string, Node>([['', root]]);
  const ensure = (path: string, dir: boolean): Node => {
    const existing = index.get(path);
    if (existing) return existing;
    const parent = ensure(dirname(path), true);
    const node: Node = { path, name: basename(path), dir, children: [] };
    parent.children.push(node);
    index.set(path, node);
    return node;
  };
  for (const d of dirs) ensure(d, true);
  for (const f of files) ensure(f, false);
  const sort = (n: Node) => {
    n.children.sort((a, b) => (a.dir === b.dir ? a.name.localeCompare(b.name) : a.dir ? -1 : 1));
    n.children.forEach(sort);
  };
  sort(root);
  return root.children;
}

type Prompt = { kind: 'file' | 'folder' | 'rename'; base: string } | null;

/** Explorateur de fichiers : arborescence, création, renommage, suppression (menu contextuel). */
export function FileTree() {
  const { store, t } = useApp();
  const version = useVfsVersion();
  const activeFile = useStoreState((s) => s.activeFile);
  const flash = useStoreState((s) => s.flash);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [prompt, setPrompt] = useState<Prompt>(null);
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);

  const tree = useMemo(() => {
    void version;
    return buildTree(store.vfs.listFiles().map((f) => f.path), store.vfs.listDirs());
  }, [store, version]);

  function startPrompt(next: Prompt, initial = '') {
    setPrompt(next);
    setName(initial);
    setError(null);
  }

  function submit() {
    if (!prompt) return;
    try {
      if (prompt.kind === 'rename') {
        store.vfs.rename(prompt.base, joinPath(dirname(prompt.base), name));
      } else {
        const path = joinPath(prompt.base, name);
        if (store.vfs.exists(path)) throw new Error(`Existe déjà : ${path}`);
        if (prompt.kind === 'file') {
          store.vfs.write(path, '', 'user');
          store.openFile(path);
        } else store.vfs.mkdir(path, 'user');
      }
      setPrompt(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  function remove(path: string) {
    if (window.confirm(t('confirmDelete', { name: path }))) store.vfs.remove(path, 'user');
  }

  const renderNode = (node: Node, depth: number) => {
    const open = !collapsed.has(node.path);
    const recent = flash[node.path] && Date.now() - flash[node.path]! < 2000;
    return (
      <li key={node.path}>
        <ContextMenu>
          <ContextMenuTrigger asChild>
            <button
              className={cn(
                'flex w-full items-center gap-1 rounded px-1 py-0.5 text-left text-[13px] hover:bg-accent/60',
                activeFile === node.path && 'bg-accent text-accent-foreground',
                recent && 'animate-flash',
              )}
              style={{ paddingLeft: depth * 12 + 4 }}
              onClick={() => {
                if (node.dir) {
                  const next = new Set(collapsed);
                  if (open) next.add(node.path);
                  else next.delete(node.path);
                  setCollapsed(next);
                } else store.openFile(node.path);
              }}
              data-path={node.path}
            >
              {node.dir ? (open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />) : <span className="w-3.5" />}
              {node.dir ? <Folder className="h-3.5 w-3.5 text-sky-400" /> : <File className="h-3.5 w-3.5 text-muted-foreground" />}
              <span className="truncate">{node.name}</span>
            </button>
          </ContextMenuTrigger>
          <ContextMenuContent>
            {node.dir && (
              <>
                <ContextMenuItem onSelect={() => startPrompt({ kind: 'file', base: node.path })}>
                  <FilePlus /> {t('newFile')}
                </ContextMenuItem>
                <ContextMenuItem onSelect={() => startPrompt({ kind: 'folder', base: node.path })}>
                  <FolderPlus /> {t('newFolder')}
                </ContextMenuItem>
              </>
            )}
            <ContextMenuItem onSelect={() => startPrompt({ kind: 'rename', base: node.path }, node.name)}>
              <Pencil /> {t('rename')}
            </ContextMenuItem>
            <ContextMenuItem className="text-red-400" onSelect={() => remove(node.path)}>
              <Trash2 /> {t('delete')}
            </ContextMenuItem>
          </ContextMenuContent>
        </ContextMenu>
        {node.dir && open && node.children.length > 0 && <ul>{node.children.map((c) => renderNode(c, depth + 1))}</ul>}
      </li>
    );
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="file-tree">
      <div className="flex items-center justify-between px-2 py-1">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t('explorer')}</span>
        <div className="flex">
          <Button size="icon" variant="ghost" title={t('newFile')} aria-label={t('newFile')} onClick={() => startPrompt({ kind: 'file', base: '' })}>
            <FilePlus />
          </Button>
          <Button size="icon" variant="ghost" title={t('newFolder')} aria-label={t('newFolder')} onClick={() => startPrompt({ kind: 'folder', base: '' })}>
            <FolderPlus />
          </Button>
        </div>
      </div>
      {prompt && (
        <form
          className="px-2 pb-1"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <input
            autoFocus
            aria-label={prompt.kind === 'rename' ? t('rename') : prompt.kind === 'file' ? t('newFile') : t('newFolder')}
            className="h-7 w-full rounded border border-input bg-transparent px-2 text-xs outline-none focus:ring-1 focus:ring-ring"
            value={name}
            placeholder={prompt.base ? `${prompt.base}/…` : 'nom'}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === 'Escape' && setPrompt(null)}
            onBlur={() => !name && setPrompt(null)}
          />
          {error && <p className="pt-1 text-xs text-red-400">{error}</p>}
        </form>
      )}
      <ul className="min-h-0 flex-1 overflow-y-auto px-1 pb-2">
        {tree.length === 0 ? <li className="px-2 py-4 text-xs text-muted-foreground">{t('emptyProject')}</li> : tree.map((n) => renderNode(n, 0))}
      </ul>
    </div>
  );
}
