import {
  convertToModelMessages,
  DefaultChatTransport,
  stepCountIs,
  streamText,
  type ChatTransport,
  type InferUITools,
  type UIMessage,
  type UIMessageChunk,
} from 'ai';
import { agentTools } from './toolDefs';
import { createModel, PROVIDERS, type ProviderId } from './providers';
import { buildSystemPrompt, type AgentContext } from './systemPrompt';
import { MAX_STEPS } from './policy';
import { MAX_REQUEST_BYTES } from './chatRequest';

export type LamUIMessage = UIMessage<unknown, never, InferUITools<typeof agentTools>>;

export interface TransportConfig {
  getSettings: () => { provider: ProviderId; model: string; apiMode: 'proxy' | 'direct'; apiBaseUrl: string };
  getKey: (provider: ProviderId) => Promise<string | null>;
  getContext: () => AgentContext;
}

type SendOptions = Parameters<ChatTransport<LamUIMessage>['sendMessages']>[0];

/** Garde les messages les plus récents pour rester sous la taille maximale de requête. */
export function trimMessages<T>(messages: T[], maxBytes = MAX_REQUEST_BYTES - 200_000): T[] {
  let kept = [...messages];
  while (kept.length > 1 && JSON.stringify(kept).length > maxBytes) kept = kept.slice(1);
  return kept;
}

/** Nombre d'étapes (appels au modèle) du dernier message assistant. */
export function countSteps(message: LamUIMessage | undefined): number {
  if (!message || message.role !== 'assistant') return 0;
  return message.parts.filter((p) => p.type === 'step-start').length;
}

/**
 * Transport du chat : proxy Vercel (`/api/chat`, clé côté serveur ou BYOK en en-tête)
 * ou mode direct (appel au fournisseur depuis le client avec la clé de l'utilisateur).
 */
export class LamTransport implements ChatTransport<LamUIMessage> {
  constructor(private readonly config: TransportConfig) {}

  async sendMessages(options: SendOptions): Promise<ReadableStream<UIMessageChunk>> {
    const settings = this.config.getSettings();
    const key = await this.config.getKey(settings.provider);
    const context = this.config.getContext();
    const messages = trimMessages(options.messages);

    if (settings.apiMode === 'direct') {
      if (!key) {
        throw new Error(`Mode direct : ajoutez votre clé ${PROVIDERS[settings.provider].label} dans Réglages.`);
      }
      const result = streamText({
        model: createModel(settings.provider, settings.model, key),
        system: buildSystemPrompt(context),
        messages: await convertToModelMessages(messages, { tools: agentTools, ignoreIncompleteToolCalls: true }),
        tools: agentTools,
        stopWhen: stepCountIs(MAX_STEPS),
        abortSignal: options.abortSignal,
      });
      return result.toUIMessageStream({
        sendReasoning: true,
        onError: (error) => (error instanceof Error ? error.message : String(error)).replace(key, '***'),
      });
    }

    const base = settings.apiBaseUrl.replace(/\/$/, '');
    const http = new DefaultChatTransport<LamUIMessage>({
      api: `${base}/api/chat`,
      headers: key ? { 'x-user-api-key': key } : undefined,
      body: { provider: settings.provider, model: settings.model, context },
      fetch: async (input, init) => {
        const response = await fetch(input, init);
        if (!response.ok) {
          let message = `Erreur serveur ${response.status}`;
          try {
            const data = (await response.clone().json()) as { error?: string };
            if (data.error) message = data.error;
          } catch {
            message = `${message} : ${(await response.text()).slice(0, 300)}`;
          }
          throw new Error(message);
        }
        return response;
      },
    });
    return http.sendMessages({ ...options, messages });
  }

  async reconnectToStream(): Promise<ReadableStream<UIMessageChunk> | null> {
    return null;
  }
}
