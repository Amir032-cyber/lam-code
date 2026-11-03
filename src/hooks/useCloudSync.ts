import { useCallback, useEffect, useRef, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { useApp } from '@/app/AppContext';
import { cloudEnabled, getSession, onAuthChange, pushMessages, pushProject, syncAll } from '@/lib/cloud/supabase';
import type { LamUIMessage } from '@/lib/agent/transport';

const SYNC_DELAY_MS = 4000;

/** Hook de synchronisation : envoie projet et conversation à Supabase quand l'utilisateur est connecté. */
export function useCloudSync() {
  const { store, platform } = useApp();
  const [session, setSession] = useState<Session | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sessionRef = useRef<Session | null>(null);
  sessionRef.current = session;

  useEffect(() => {
    if (!cloudEnabled) return;
    void getSession().then(setSession);
    return onAuthChange(setSession);
  }, []);

  const syncNow = useCallback(async () => {
    const project = store.getState().project;
    if (!sessionRef.current || !project) return null;
    try {
      const remoteId = await pushProject(project, store.vfs.snapshot());
      if (project.remoteId !== remoteId) await store.updateProjectMeta({ remoteId });
      setStatus(`Synchronisé à ${new Date().toLocaleTimeString()}`);
      return remoteId;
    } catch (error) {
      setStatus(`Échec de synchronisation : ${error instanceof Error ? error.message : String(error)}`);
      return null;
    }
  }, [store]);

  useEffect(() => {
    if (!session) return;
    void store
      .flush()
      .then(() => syncAll((meta) => platform.fs.loadProject(meta)))
      .then(async (report) => {
        setStatus(`Synchronisé : ${report.imported} importé(s), ${report.uploaded} envoyé(s)`);
        if (report.imported > 0) await store.init();
      })
      .catch((error: unknown) => setStatus(`Échec de récupération : ${error instanceof Error ? error.message : String(error)}`));
    return store.vfs.subscribe(() => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => void syncNow(), SYNC_DELAY_MS);
    });
  }, [session, store, platform, syncNow]);

  const onMessagesSaved = useCallback(
    (projectId: string, messages: LamUIMessage[]) => {
      const project = store.getState().project;
      if (!sessionRef.current || !project?.remoteId || project.id !== projectId) return;
      void pushMessages(project.remoteId, messages).catch((error: unknown) =>
        setStatus(`Échec d'envoi de la conversation : ${error instanceof Error ? error.message : String(error)}`),
      );
    },
    [store],
  );

  return { session, status, syncNow, onMessagesSaved };
}

