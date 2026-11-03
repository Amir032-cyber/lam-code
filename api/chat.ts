import { convertToModelMessages, stepCountIs, streamText, type UIMessage } from 'ai';
import { chatRequestSchema, MAX_REQUEST_BYTES } from '../src/lib/agent/chatRequest.js';
import { createModel, PROVIDERS } from '../src/lib/agent/providers.js';
import { buildSystemPrompt } from '../src/lib/agent/systemPrompt.js';
import { agentTools } from '../src/lib/agent/toolDefs.js';
import { MAX_STEPS } from '../src/lib/agent/policy.js';

export const config = { maxDuration: 60 };

const STATIC_ORIGINS = [
  'tauri://localhost',
  'http://tauri.localhost',
  'https://tauri.localhost',
  'capacitor://localhost',
  'https://localhost',
  'http://localhost',
];

function allowedOrigins(): string[] {
  const extra = (process.env.ALLOWED_ORIGIN ?? '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
  const vercel = process.env.VERCEL_PROJECT_PRODUCTION_URL
    ? [`https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`]
    : [];
  return [...STATIC_ORIGINS, ...extra, ...vercel];
}

export function isOriginAllowed(origin: string | null, requestUrl: string): boolean {
  if (!origin) return true;
  if (origin === new URL(requestUrl).origin) return true;
  if (/^http:\/\/localhost:\d+$/.test(origin) || /^http:\/\/127\.0\.0\.1:\d+$/.test(origin)) {
    return process.env.NODE_ENV !== 'production' || process.env.VERCEL_ENV !== 'production';
  }
  return allowedOrigins().includes(origin);
}

function corsHeaders(origin: string | null): Record<string, string> {
  return {
    ...(origin ? { 'Access-Control-Allow-Origin': origin, Vary: 'Origin' } : {}),
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, x-user-api-key',
    'Access-Control-Max-Age': '86400',
    'Cross-Origin-Resource-Policy': 'cross-origin',
  };
}

const RATE_LIMIT = 30;
const RATE_WINDOW_MS = 60_000;
const hits = new Map<string, number[]>();

/** Limite de débit simple par IP (fenêtre glissante, par instance serverless). */
export function rateLimited(ip: string, now = Date.now()): boolean {
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < RATE_WINDOW_MS);
  recent.push(now);
  hits.set(ip, recent);
  if (hits.size > 10_000) hits.clear();
  return recent.length > RATE_LIMIT;
}

export function resetRateLimit() {
  hits.clear();
}

function json(status: number, body: unknown, headers: Record<string, string>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

export function OPTIONS(request: Request): Response {
  const origin = request.headers.get('origin');
  if (!isOriginAllowed(origin, request.url)) return new Response(null, { status: 403 });
  return new Response(null, { status: 204, headers: corsHeaders(origin) });
}

export async function POST(request: Request): Promise<Response> {
  const origin = request.headers.get('origin');
  if (!isOriginAllowed(origin, request.url)) {
    return json(403, { error: 'Origine non autorisée' }, {});
  }
  const headers = corsHeaders(origin);

  const ip =
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    request.headers.get('x-real-ip') ||
    'local';
  if (rateLimited(ip)) {
    return json(429, { error: 'Trop de requêtes, réessayez dans une minute.' }, headers);
  }

  const declared = Number(request.headers.get('content-length') ?? '0');
  if (declared > MAX_REQUEST_BYTES) return json(413, { error: 'Requête trop volumineuse' }, headers);
  const raw = await request.text();
  if (raw.length > MAX_REQUEST_BYTES) return json(413, { error: 'Requête trop volumineuse' }, headers);

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(raw);
  } catch {
    return json(400, { error: 'JSON invalide' }, headers);
  }
  const parsed = chatRequestSchema.safeParse(parsedJson);
  if (!parsed.success) {
    return json(400, { error: 'Corps de requête invalide', issues: parsed.error.issues.length }, headers);
  }
  const { messages, provider, model, context } = parsed.data;

  const apiKey =
    request.headers.get('x-user-api-key')?.trim() || process.env[PROVIDERS[provider].serverEnv] || '';
  if (!apiKey) {
    return json(
      401,
      { error: `Aucune clé ${PROVIDERS[provider].label} : ajoutez-la dans Réglages.`, code: 'missing_key' },
      headers,
    );
  }

  try {
    const result = streamText({
      model: createModel(provider, model, apiKey),
      system: buildSystemPrompt(context),
      messages: await convertToModelMessages(messages as unknown as UIMessage[], {
        tools: agentTools,
        ignoreIncompleteToolCalls: true,
      }),
      tools: agentTools,
      stopWhen: stepCountIs(MAX_STEPS),
      abortSignal: request.signal,
    });
    return result.toUIMessageStreamResponse({
      headers,
      sendReasoning: true,
      onError: (error) => {
        const message = error instanceof Error ? error.message : String(error);
        return message.replace(apiKey, '***');
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message.replace(apiKey, '***') : 'Erreur inconnue';
    return json(500, { error: message }, headers);
  }
}
