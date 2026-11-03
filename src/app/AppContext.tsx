/* eslint-disable react-refresh/only-export-components */
import { createContext, useCallback, useContext, useMemo, useState, useSyncExternalStore, type ReactNode } from 'react';
import type { PlatformAdapter } from '@/lib/platform/types';
import { ProjectStore, type StoreState } from '@/lib/store/projectStore';
import { loadSettings, saveSettings, type Settings } from '@/lib/settings';
import { translate, type MessageKey } from '@/lib/i18n';

interface AppContextValue {
  platform: PlatformAdapter;
  store: ProjectStore;
  settings: Settings;
  updateSettings: (patch: Partial<Settings>) => void;
  t: (key: MessageKey, vars?: Record<string, string>) => string;
}

const AppContext = createContext<AppContextValue | null>(null);

export function AppProvider({ platform, store, children }: { platform: PlatformAdapter; store: ProjectStore; children: ReactNode }) {
  const [settings, setSettings] = useState<Settings>(loadSettings);
  const updateSettings = useCallback((patch: Partial<Settings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...patch };
      saveSettings(next);
      document.documentElement.classList.toggle('dark', next.theme === 'dark');
      document.documentElement.lang = next.language;
      return next;
    });
  }, []);
  const t = useCallback(
    (key: MessageKey, vars?: Record<string, string>) => translate(settings.language, key, vars),
    [settings.language],
  );
  const value = useMemo(
    () => ({ platform, store, settings, updateSettings, t }),
    [platform, store, settings, updateSettings, t],
  );
  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp(): AppContextValue {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp doit être utilisé dans <AppProvider>');
  return ctx;
}

export function useStoreState<T>(selector: (state: StoreState) => T): T {
  const { store } = useApp();
  return useSyncExternalStore(store.subscribe, () => selector(store.getState()));
}

export function useVfsVersion(): number {
  const { store } = useApp();
  return useSyncExternalStore(
    (cb) => store.vfs.subscribe(cb),
    () => store.vfs.getVersion(),
  );
}
