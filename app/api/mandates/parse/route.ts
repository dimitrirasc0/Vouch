// Natural-language mandate -> validated rules (Claude structured output) -> stored DRAFT mandate.
import { z } from 'zod';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import { claude, FALLBACK, MODEL } from '@/lib/claude';
import { categories } from '@/lib/catalog';
import { createMandate } from '@/lib/mandates';
import type { MandateRules } from '@/lib/mandate';

const RulesSchema = z.object({
  category: z.enum(categories).describe('The single catalog category the agent may buy from'),
  maxAmount: z.number().describe('Maximum price for the purchase, in currency units'),
  currency: z.enum(['USD']),
  expiresAt: z.string().describe('ISO 8601 UTC timestamp when the mandate stops being valid'),
  deliverBy: z.string().nullable().describe('ISO 8601 date the item must arrive by, or null if not stated'),
  notes: z.string().nullable().describe('Preferences that are not hard rules (e.g. brand, wattage), or null'),
  understood: z.boolean().describe('false if the request cannot be expressed as a purchase in one catalog category'),
  problem: z.string().nullable().describe('If understood is false, one sentence explaining what is missing'),
});

const SYSTEM = `You convert a shopper's instructions for an AI shopping agent into a strict purchase mandate.
Rules:
- Pick exactly one category from the allowed list. If none fits, set understood=false.
- maxAmount is the most the shopper will pay for the item. If they give no limit, set understood=false.
- If no expiry is stated, the mandate expires 7 days from now at 23:59:59 UTC.
- "by Friday" style deadlines become deliverBy dates, resolved against the current date provided.
- Never invent constraints the shopper did not express. Soft preferences go in notes.`;

export async function POST(req: Request) {
  const { text } = (await req.json()) as { text?: string };
  if (!text || text.trim().length < 5) return Response.json({ error: 'Describe what the agent may buy.' }, { status: 400 });

  const now = new Date();
  const res = await claude().beta.messages.parse({
    model: MODEL,
    max_tokens: 4000,
    ...FALLBACK,
    output_config: { effort: 'low', format: betaZodOutputFormat(RulesSchema) },
    system: SYSTEM,
    messages: [
      {
        role: 'user',
        content: `Current date and time: ${now.toISOString()} (${now.toUTCString().slice(0, 3)}).\nAllowed categories: ${categories.join(', ')}.\n\nShopper's instructions:\n${text.trim()}`,
      },
    ],
  });

  const out = res.parsed_output;
  if (!out) return Response.json({ error: `Could not parse mandate (stop: ${res.stop_reason})` }, { status: 502 });
  if (!out.understood) return Response.json({ error: out.problem ?? 'Mandate is incomplete.' }, { status: 422 });
  if (!(out.maxAmount > 0 && out.maxAmount <= 1000)) return Response.json({ error: 'Limit must be between $0 and $1,000.' }, { status: 422 });
  const expires = new Date(out.expiresAt);
  if (Number.isNaN(expires.getTime()) || expires <= now) return Response.json({ error: 'Expiry must be in the future.' }, { status: 422 });

  const rules: MandateRules = {
    category: out.category,
    maxAmount: Math.round(out.maxAmount * 100) / 100,
    currency: out.currency,
    expiresAt: expires.toISOString(),
    ...(out.deliverBy ? { deliverBy: new Date(out.deliverBy).toISOString() } : {}),
    ...(out.notes ? { notes: out.notes } : {}),
  };
  const mandate = await createMandate(text.trim(), rules);
  return Response.json({ mandate, usage: res.usage });
}
