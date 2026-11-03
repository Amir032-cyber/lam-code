// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isOriginAllowed, OPTIONS, POST, rateLimited, resetRateLimit } from '../../api/chat';

const body = {
  provider: 'openrouter',
  model: 'meta-llama/llama-3.3-70b-instruct',
  messages: [{ id: '1', role: 'user', parts: [{ type: 'text', text: 'Bonjour' }] }],
  context: {
    platform: 'web',
    platformLabel: 'Web',
    sandboxDescription: 'WebContainer',
    canExec: true,
    language: 'fr',
    fileTree: '',
    uploads: [],
    projectName: 'p',
  },
};

function req(payload: unknown, headers: Record<string, string> = {}) {
  return new Request('http://localhost:5173/api/chat', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: typeof payload === 'string' ? payload : JSON.stringify(payload),
  });
}

describe('api/chat', () => {
  beforeEach(() => {
    resetRateLimit();
    vi.stubEnv('OPENROUTER_API_KEY', '');
  });
  afterEach(() => vi.unstubAllEnvs());

  it('refuse les origines inconnues', async () => {
    expect(isOriginAllowed('https://evil.example', 'https://lam.vercel.app/api/chat')).toBe(false);
    expect(isOriginAllowed('tauri://localhost', 'https://lam.vercel.app/api/chat')).toBe(true);
    expect(isOriginAllowed(null, 'https://lam.vercel.app/api/chat')).toBe(true);
    const res = await POST(req(body, { origin: 'https://evil.example' }));
    expect(res.status).toBe(403);
  });
  it('répond au pré-vol CORS', () => {
    const res = OPTIONS(new Request('http://localhost:5173/api/chat', { method: 'OPTIONS', headers: { origin: 'capacitor://localhost' } }));
    expect(res.status).toBe(204);
    expect(res.headers.get('access-control-allow-origin')).toBe('capacitor://localhost');
    expect(res.headers.get('access-control-allow-headers')).toContain('x-user-api-key');
  });
  it('valide le JSON et le schéma', async () => {
    expect((await POST(req('{pas du json'))).status).toBe(400);
    expect((await POST(req({ ...body, provider: 'inconnu' }))).status).toBe(400);
    expect((await POST(req({ ...body, messages: [] }))).status).toBe(400);
  });
  it('exige une clé sans jamais la renvoyer', async () => {
    const res = await POST(req(body));
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ code: 'missing_key' });
  });
  it('limite le débit par IP', () => {
    const now = 1_000_000;
    for (let i = 0; i < 30; i++) expect(rateLimited('1.2.3.4', now)).toBe(false);
    expect(rateLimited('1.2.3.4', now)).toBe(true);
    expect(rateLimited('5.6.7.8', now)).toBe(false);
    expect(rateLimited('1.2.3.4', now + 61_000)).toBe(false);
  });
  it('rejette les corps trop volumineux', async () => {
    const res = await POST(req(body, { 'content-length': String(50_000_000) }));
    expect(res.status).toBe(413);
  });
});
