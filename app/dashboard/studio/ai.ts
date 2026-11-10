// The AG Studio AI assistant, running on Claude. The adapter posts to this app's /api/ai/claude
// route, which holds the Anthropic key, so nothing secret is sent from the browser.

import { createAiHarness, type AgAiHarnessSetup, type AgAiPromptStarter } from 'ag-studio';
import { claudeAdapter } from './claude-adapter';

// Suggestions shown in a new AI conversation, before anything has been typed.
const PROMPT_STARTERS: AgAiPromptStarter[] = [
  {
    label: 'Summarise this page',
    prompt: 'Summarise what this page shows: every widget, the fields it reads, and what stands out.',
  },
  {
    label: 'Where is money at risk?',
    prompt: 'Which open disputes put the most money at risk, and what did the agent recommend for each?',
  },
  {
    label: 'Chart agent mistakes',
    prompt: 'Add a chart comparing agent spend within vs outside the mandate, by item.',
  },
];

// `models` are the Claude model ids allowed on the server (lib/ai.ts); the picker shows for two or more.
export function buildAi(models: string[]): AgAiHarnessSetup {
  const adapter = claudeAdapter();

  return ({ api }) =>
    createAiHarness(api, {
      adapter,
      promptStarters: PROMPT_STARTERS,
      models: models.length > 1 ? models.map((id) => ({ id, label: id })) : undefined,
    });
}
