import { z } from 'zod';
import { PROVIDER_IDS, type ProviderId } from './providers.js';

export const MAX_REQUEST_BYTES = 4_000_000;

export const agentContextSchema = z.object({
  platform: z.enum(['web', 'desktop', 'mobile']),
  platformLabel: z.string().max(64),
  sandboxDescription: z.string().max(500),
  canExec: z.boolean(),
  language: z.enum(['fr', 'en']),
  fileTree: z.string().max(40_000),
  uploads: z.array(z.string().max(300)).max(200),
  projectName: z.string().max(200),
});

export const chatRequestSchema = z.object({
  messages: z.array(z.record(z.string(), z.unknown())).min(1).max(400),
  provider: z.enum(PROVIDER_IDS as [ProviderId, ...ProviderId[]]),
  model: z.string().min(1).max(120),
  context: agentContextSchema,
});

export type ChatRequestBody = z.infer<typeof chatRequestSchema>;
