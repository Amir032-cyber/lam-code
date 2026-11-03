import { useEffect, useState } from 'react';
import { AppProvider } from '@/app/AppContext';
import { AppShell } from '@/components/layout/AppShell';
import { TooltipProvider } from '@/components/ui/tooltip';
import { getPlatform } from '@/lib/platform';
import { ProjectStore } from '@/lib/store/projectStore';
import { loadSettings } from '@/lib/settings';

export default function App() {
  const [platform] = useState(getPlatform);
  const [store] = useState(() => new ProjectStore(platform));

  useEffect(() => {
    const settings = loadSettings();
    document.documentElement.classList.toggle('dark', settings.theme === 'dark');
    document.documentElement.lang = settings.language;
    void store.init();
    const flush = () => void store.flush();
    window.addEventListener('beforeunload', flush);
    return () => window.removeEventListener('beforeunload', flush);
  }, [store]);

  return (
    <AppProvider platform={platform} store={store}>
      <TooltipProvider delayDuration={300}>
        <AppShell />
      </TooltipProvider>
    </AppProvider>
  );
}
