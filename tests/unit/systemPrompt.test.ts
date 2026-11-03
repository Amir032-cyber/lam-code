import { describe, expect, it } from 'vitest';
import { buildSystemPrompt, type AgentContext } from '@/lib/agent/systemPrompt';

const base: AgentContext = {
  platform: 'web',
  platformLabel: 'Web',
  sandboxDescription: 'WebContainer',
  canExec: true,
  language: 'fr',
  fileTree: 'index.html',
  uploads: ['uploads/cdc.pdf'],
  projectName: 'Démo',
};

describe('buildSystemPrompt', () => {
  it('inclut le contexte dynamique et les règles', () => {
    const prompt = buildSystemPrompt(base);
    expect(prompt).toContain('Démo');
    expect(prompt).toContain('index.html');
    expect(prompt).toContain('uploads/cdc.pdf');
    expect(prompt).toContain('WebContainer');
    expect(prompt).toContain('Réflexion');
    expect(prompt).toMatch(/ask_user/);
  });
  it('adapte les limites à la plateforme', () => {
    expect(buildSystemPrompt({ ...base, platform: 'desktop' })).toContain('PowerShell');
    expect(buildSystemPrompt({ ...base, platform: 'mobile', canExec: false })).toContain('sandbox distant');
  });
});
