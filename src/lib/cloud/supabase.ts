import { createClient, type Session, type SupabaseClient } from '@supabase/supabase-js';
import { App } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';
import { chatKey, kvGet, kvSet, listProjects, saveProjectFiles, saveProjectMeta, type ProjectMeta } from '@/lib/fs/persist';
import type { ProjectFiles } from '@/lib/fs/vfs';
import { uid } from '@/lib/utils';
import { unzipProject, zipProject } from './zip';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

/** Client Supabase, ou null si l'application fonctionne en mode local uniquement. */
export const supabase: SupabaseClient | null =
  url && anonKey ? createClient(url, anonKey, { auth: { flowType: 'pkce', detectSessionInUrl: true } }) : null;
export const cloudEnabled = supabase !== null;

/** Retour OAuth sur Android : lien profond enregistré dans AndroidManifest.xml (à autoriser dans Supabase). */
export const NATIVE_REDIRECT_URL = 'com.lamcode.app://auth-callback';

if (supabase && Capacitor.isNativePlatform()) {
  void App.addListener('appUrlOpen', ({ url: opened }) => {
    if (!opened.startsWith(NATIVE_REDIRECT_URL)) return;
    const code = new URL(opened).searchParams.get('code');
    if (code) void supabase?.auth.exchangeCodeForSession(code);
  });
}

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
  const native = Capacitor.isNativePlatform();
  const { data, error } = await client().auth.signInWithOAuth({
    provider: 'github',
    options: { redirectTo: native ? NATIVE_REDIRECT_URL : window.location.origin, skipBrowserRedirect: native },
  });
  if (error) throw error;
  // Android : Capacitor ouvre les URL externes dans le navigateur système, qui revient via le lien profond.
  if (native && data.url) window.location.href = data.url;
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

interface RemoteProject {
  id: string;
  local_id: string;
  name: string;
  files: ProjectFiles;
  created_at: string;
  updated_at: string;
}

export interface SyncReport {
  imported: number;
  uploaded: number;
}

/**
 * Réconciliation complète à la connexion : importe les projets distants plus récents (fichiers + conversation)
 * et envoie les projets locaux absents ou plus récents côté serveur (dernier écrit gagne).
 */
export async function syncAll(loadFiles: (meta: ProjectMeta) => Promise<ProjectFiles>): Promise<SyncReport> {
  const db = client();
  const { data, error } = await db.from('projects').select('id, local_id, name, files, created_at, updated_at');
  if (error) throw error;
  const remote = new Map(((data ?? []) as RemoteProject[]).map((row) => [row.local_id, row]));
  const { data: chats, error: chatError } = await db.from('messages').select('project_id, content');
  if (chatError) throw chatError;
  const chatByRemoteId = new Map(((chats ?? []) as { project_id: string; content: unknown[] }[]).map((c) => [c.project_id, c.content]));
  const local = new Map((await listProjects()).map((p) => [p.id, p]));
  const report: SyncReport = { imported: 0, uploaded: 0 };

  for (const row of remote.values()) {
    const remoteUpdated = Date.parse(row.updated_at);
    const existing = local.get(row.local_id);
    if (existing && existing.updatedAt >= remoteUpdated) continue;
    await saveProjectFiles(row.local_id, row.files);
    const chat = chatByRemoteId.get(row.id);
    if (chat) await kvSet(chatKey(row.local_id), chat);
    await saveProjectMeta({
      ...(existing ?? {}),
      id: row.local_id,
      name: row.name,
      createdAt: existing?.createdAt ?? Date.parse(row.created_at),
      updatedAt: remoteUpdated,
      remoteId: row.id,
    });
    report.imported++;
  }

  for (const meta of local.values()) {
    const row = remote.get(meta.id);
    if (row && Date.parse(row.updated_at) >= meta.updatedAt) continue;
    const remoteId = await pushProject(meta, await loadFiles(meta));
    const chat = await kvGet<unknown[]>(chatKey(meta.id));
    if (chat?.length) await pushMessages(remoteId, chat);
    if (meta.remoteId !== remoteId) await saveProjectMeta({ ...meta, remoteId });
    report.uploaded++;
  }
  return report;
}

/** Une conversation par projet, remplacée atomiquement (upsert) : aucun historique perdu en cas d'échec. */
export async function pushMessages(remoteId: string, messages: unknown[]) {
  const { error } = await client()
    .from('messages')
    .upsert({ project_id: remoteId, content: messages }, { onConflict: 'project_id' });
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
