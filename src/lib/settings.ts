import { PROVIDERS, isProviderId, type ProviderId } from './agent/providers';

export interface Settings {
  provider: ProviderId;
  models: Record<ProviderId, string>;
  apiMode: 'proxy' | 'direct';
  apiBaseUrl: string;
  sandboxUrl: string;
  approval: 'ask' | 'auto';
  language: 'fr' | 'en';
  theme: 'dark' | 'light';
}

const KEY = 'lam:settings';

export const DEFAULT_SETTINGS: Settings = {
  provider: 'groq',
  models: {
    groq: PROVIDERS.groq.defaultModel,
    google: PROVIDERS.google.defaultModel,
    openrouter: PROVIDERS.openrouter.defaultModel,
  },
  apiMode: 'proxy',
  apiBaseUrl: import.meta.env.VITE_API_BASE_URL ?? '',
  sandboxUrl: '',
  approval: 'ask',
  language: typeof navigator !== 'undefined' && navigator.language.startsWith('en') ? 'en' : 'fr',
  theme: 'dark',
};

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return DEFAULT_SETTINGS;
    const parsed = JSON.parse(raw) as Partial<Settings>;
    return {
      ...DEFAULT_SETTINGS,
      ...parsed,
      provider: isProviderId(parsed.provider) ? parsed.provider : DEFAULT_SETTINGS.provider,
      models: { ...DEFAULT_SETTINGS.models, ...(parsed.models ?? {}) },
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function saveSettings(settings: Settings): void {
  localStorage.setItem(KEY, JSON.stringify(settings));
}

const allowKey = (projectId: string) => `lam:allow:${projectId}`;

export type AllowedTools = Partial<Record<'write_file' | 'run_command', boolean>>;

export function loadAllowed(projectId: string): AllowedTools {
  try {
    return JSON.parse(localStorage.getItem(allowKey(projectId)) ?? '{}') as AllowedTools;
  } catch {
    return {};
  }
}

export function saveAllowed(projectId: string, allowed: AllowedTools): void {
  localStorage.setItem(allowKey(projectId), JSON.stringify(allowed));
}

export const SECRET_NAMES = ['groq', 'google', 'openrouter', 'sandbox'] as const;
export type SecretName = (typeof SECRET_NAMES)[number];
