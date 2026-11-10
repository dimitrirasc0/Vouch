// Shared Claude client. Server-only: reads ANTHROPIC_API_KEY from the environment.
import 'server-only';
import Anthropic from '@anthropic-ai/sdk';

export const MODEL = 'claude-opus-5-5';

// Server-side fallback: if a request is declined by a safety classifier, the API re-runs it on a
// suitable fallback model inside the same call.
export const FALLBACK: { betas: Anthropic.Beta.AnthropicBeta[]; fallbacks: 'default' } = {
  betas: ['server-side-fallback-2026-07-01'],
  fallbacks: 'default',
};

declare global {
  var __vouchClaude: Anthropic | undefined;
}

export function claude(): Anthropic {
  globalThis.__vouchClaude ??= new Anthropic();
  return globalThis.__vouchClaude;
}
