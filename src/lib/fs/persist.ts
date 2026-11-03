import { createStore, del, get, set, type UseStore } from 'idb-keyval';
import type { ProjectFiles } from './vfs';

export interface ProjectMeta {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  workspacePath?: string;
  remoteId?: string;
}

let store: UseStore | undefined;
function db(): UseStore {
  store ??= createStore('lam-code', 'kv');
  return store;
}

const PROJECTS_KEY = 'lam:projects';
const filesKey = (id: string) => `lam:files:${id}`;

export async function listProjects(): Promise<ProjectMeta[]> {
  const projects = (await get<ProjectMeta[]>(PROJECTS_KEY, db())) ?? [];
  return [...projects].sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function saveProjectMeta(meta: ProjectMeta): Promise<void> {
  const projects = (await get<ProjectMeta[]>(PROJECTS_KEY, db())) ?? [];
  const next = projects.filter((p) => p.id !== meta.id);
  next.push(meta);
  await set(PROJECTS_KEY, next, db());
}

export async function deleteProjectMeta(id: string): Promise<void> {
  const projects = (await get<ProjectMeta[]>(PROJECTS_KEY, db())) ?? [];
  await set(PROJECTS_KEY, projects.filter((p) => p.id !== id), db());
  await del(filesKey(id), db());
}

export async function loadProjectFiles(id: string): Promise<ProjectFiles> {
  return (await get<ProjectFiles>(filesKey(id), db())) ?? { files: [], dirs: [] };
}

export async function saveProjectFiles(id: string, data: ProjectFiles): Promise<void> {
  await set(filesKey(id), data, db());
}

export async function kvGet<T>(key: string): Promise<T | undefined> {
  return get<T>(key, db());
}

export async function kvSet<T>(key: string, value: T): Promise<void> {
  await set(key, value, db());
}

export async function kvDel(key: string): Promise<void> {
  await del(key, db());
}

/** Clé IndexedDB de la conversation d'un projet. */
export const chatKey = (projectId: string) => `lam:chat:${projectId}`;
