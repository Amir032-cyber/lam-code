import { Capacitor } from '@capacitor/core';
import type { PlatformAdapter } from './types';
import { createWebPlatform } from './web';
import { createTauriPlatform } from './tauri';
import { createCapacitorPlatform } from './capacitor';

export type { PlatformAdapter } from './types';

export function detectPlatform(): 'web' | 'desktop' | 'mobile' {
  if (typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window) return 'desktop';
  if (Capacitor.isNativePlatform()) return 'mobile';
  return 'web';
}

let instance: PlatformAdapter | null = null;

export function getPlatform(): PlatformAdapter {
  if (instance) return instance;
  const kind = detectPlatform();
  instance =
    kind === 'desktop' ? createTauriPlatform() : kind === 'mobile' ? createCapacitorPlatform() : createWebPlatform();
  return instance;
}

export function setPlatformForTests(platform: PlatformAdapter | null) {
  instance = platform;
}
