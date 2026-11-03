import { createClient, type Session, type SupabaseClient } from '@supabase/supabase-js';
import { listProjects, saveProjectFiles, saveProjectMeta, type ProjectMeta } from '@/lib/fs/persist';
import type { ProjectFiles } from '@/lib/fs/vfs';
import { uid } from '@/lib/utils';
import { unzipProject, zipProject } from './zip';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

/** Client Supabase, ou null si l'application fonctionne en mode local uniquement. */
export const supabase: SupabaseClient | null = url && anonKey ? createClient(url, anonKey) : null;
export const cloudEnabled = supabase !== null;

function client(): SupabaseClient {
  if (!supabase) throw new Error('Synchronisation désactivée : VITE_SUPABASE_URL et VITE_SUPABASE_ANON_KEY ne sont pas configurés.');
  return supabase;
}

export interface SnapshotRow {
  id: string;
  label: string;
  storage_path: string;
  size_bytes: number;
  created_at: string;
}

export async function getSession(): Promise<Session | null> {
  if (!supabase) return null;
  const { data } = await supabase.auth.getSession();
  return data.session;
}

export function onAuthChange(listener: (session: Session | null) => void): () => void {
  if (!supabase) return () => undefined;
  const { data } = supabase.auth.onAuthStateChange((_event, session) => listener(session));
  return () => data.subscription.unsubscribe();
}

export async function signIn(email: string, password: string) {
  const { error } = await client().auth.signInWithPassword({ email, password });
  if (error) throw error;
}

export async function signUp(email: string, password: string): Promise<boolean> {
  const { data, error } = await client().auth.signUp({ email, password });
  if (error) throw error;
  return data.session !== null;
}

export async function signInWithGitHub() {
  const { error } = await client().auth.signInWithOAuth({
    provider: 'github',
    options: { redirectTo: window.location.origin },
  });
  if (error) throw error;
}

export async function signOut() {
  await client().auth.signOut();
}

/** Envoie le projet (métadonnées + fichiers) ; renvoie l'identifiant distant. */
export async function pushProject(meta: ProjectMeta, files: ProjectFiles): Promise<string> {
  const { data, error } = await client()
    .from('projects')
    .upsert({ local_id: meta.id, name: meta.name, files }, { onConflict: 'user_id,local_id' })
    .select('id')
    .single();
  if (error) throw error;
  return (data as { id: string }).id;
}

/** Récupère les projets distants plus récents que leur copie locale. Renvoie le nombre importé. */
export async function pullProjects(): Promise<number> {
  const { data, error } = await client().from('projects').select('id, local_id, name, files, created_at, updated_at');
  if (error) throw error;
  const local = new Map((await listProjects()).map((p) => [p.id, p]));
  let imported = 0;
  for (const row of (data ?? []) as {
    id: string;
    local_id: string;
    name: string;
    files: ProjectFiles;
    created_at: string;
    updated_at: string;
  }[]) {
    const remoteUpdated = Date.parse(row.updated_at);
    const existing = local.get(row.local_id);
    if (existing && existing.updatedAt >= remoteUpdated) continue;
    await saveProjectFiles(row.local_id, row.files);
    await saveProjectMeta({
      ...(existing ?? {}),
      id: row.local_id,
      name: row.name,
      createdAt: existing?.createdAt ?? Date.parse(row.created_at),
      updatedAt: remoteUpdated,
      remoteId: row.id,
    });
    imported++;
  }
  return imported;
}

export async function pushMessages(remoteId: string, messages: unknown[]) {
  const db = client();
  const { error: deleteError } = await db.from('messages').delete().eq('project_id', remoteId);
  if (deleteError) throw deleteError;
  if (messages.length === 0) return;
  const { error } = await db.from('messages').insert({ project_id: remoteId, content: messages });
  if (error) throw error;
}

export async function createSnapshot(remoteId: string, files: ProjectFiles, label: string): Promise<SnapshotRow> {
  const db = client();
  const { data: user } = await db.auth.getUser();
  if (!user.user) throw new Error('Connectez-vous pour créer un snapshot.');
  const blob = await zipProject(files);
  const path = `${user.user.id}/${remoteId}/${Date.now()}-${uid()}.zip`;
  const { error: uploadError } = await db.storage.from('snapshots').upload(path, blob, { contentType: 'application/zip' });
  if (uploadError) throw uploadError;
  const { data, error } = await db
    .from('snapshots')
    .insert({ project_id: remoteId, label, storage_path: path, size_bytes: blob.size })
    .select('id, label, storage_path, size_bytes, created_at')
    .single();
  if (error) throw error;
  return data as SnapshotRow;
}

export async function listSnapshots(remoteId: string): Promise<SnapshotRow[]> {
  const { data, error } = await client()
    .from('snapshots')
    .select('id, label, storage_path, size_bytes, created_at')
    .eq('project_id', remoteId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as SnapshotRow[];
}

export async function restoreSnapshot(snapshot: SnapshotRow): Promise<ProjectFiles> {
  const { data, error } = await client().storage.from('snapshots').download(snapshot.storage_path);
  if (error) throw error;
  return unzipProject(data);
}
