import { createGroq } from '@ai-sdk/groq';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import type { LanguageModel } from 'ai';

export type ProviderId = 'groq' | 'google' | 'openrouter';

export interface ProviderInfo {
  id: ProviderId;
  label: string;
  defaultModel: string;
  models: string[];
  multimodal: (model: string) => boolean;
  keyUrl: string;
  serverEnv: string;
}

export const PROVIDERS: Record<ProviderId, ProviderInfo> = {
  groq: {
    id: 'groq',
    label: 'Groq',
    defaultModel: 'llama-3.3-70b-versatile',
    models: ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant'],
    multimodal: () => false,
    keyUrl: 'https://console.groq.com/keys',
    serverEnv: 'GROQ_API_KEY',
  },
  google: {
    id: 'google',
    label: 'Google Gemini',
    defaultModel: 'gemini-2.0-flash',
    models: ['gemini-2.0-flash', 'gemini-2.5-flash', 'gemini-2.5-pro'],
    multimodal: () => true,
    keyUrl: 'https://aistudio.google.com/app/apikey',
    serverEnv: 'GOOGLE_GENERATIVE_AI_API_KEY',
  },
  openrouter: {
    id: 'openrouter',
    label: 'OpenRouter',
    defaultModel: 'meta-llama/llama-3.3-70b-instruct',
    models: [
      'meta-llama/llama-3.3-70b-instruct',
      'google/gemini-2.5-flash',
      'google/gemini-2.0-flash-001',
    ],
    multimodal: (model) => model.startsWith('google/'),
    keyUrl: 'https://openrouter.ai/keys',
    serverEnv: 'OPENROUTER_API_KEY',
  },
};

export const PROVIDER_IDS = Object.keys(PROVIDERS) as ProviderId[];

export function isProviderId(value: unknown): value is ProviderId {
  return typeof value === 'string' && value in PROVIDERS;
}

export function createModel(provider: ProviderId, model: string, apiKey: string): LanguageModel {
  switch (provider) {
    case 'groq':
      return createGroq({ apiKey })(model);
    case 'google':
      return createGoogleGenerativeAI({ apiKey })(model);
    case 'openrouter':
      return createOpenRouter({
        apiKey,
        headers: { 'X-Title': 'LAM-Code', 'HTTP-Referer': 'https://github.com/Amir032-cyber/lam-code' },
      }).chat(model);
  }
}
