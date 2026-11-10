// The shopping agent: Claude searches the catalog and buys one item for the buyer, but only through
// tools that enforce the mandate in code. Every tool call is logged as the decision trail that the
// dispute agent later cites as evidence.
import 'server-only';
import { z } from 'zod';
import { betaZodTool } from '@anthropic-ai/sdk/helpers/beta/zod';
import { claude, FALLBACK, MODEL } from '../claude';
import { query } from '../db';
import { catalog, findItem } from '../catalog';
import { checkMandate } from '../mandate';
import { getMandate } from '../mandates';
import { addTracking, MandateViolation, purchase, type PurchaseRow } from '../purchases';

const SYSTEM = `You are a shopping agent buying one item for a shopper, under a mandate they approved in PayPal.
Process: search the catalog, shortlist candidates, call check_mandate on your top choice (and alternatives if it fails), buy exactly one item that passes with purchase, then call add_tracking for that purchase, then stop.
Respect the shopper's soft preferences when choosing among items that pass. Before each tool call, say in one short sentence what you are doing and why. Finish with a two-sentence summary of what you bought and why.`;

export async function runShopper(mandateId: string, { overstep = false } = {}) {
  const m = await getMandate(mandateId);
  if (!m) throw new Error('Mandate not found');
  if (m.status !== 'AUTHORIZED') throw new Error(`Mandate is ${m.status}; it must be AUTHORIZED (approved in PayPal) and unused`);

  // Steps continue after any earlier run for this mandate.
  const prev = await query<{ n: number }>(`SELECT COALESCE(MAX(step), 0)::int AS n FROM agent_decisions WHERE mandate_id = $1 AND agent = 'shopper'`, [m.id]);
  let step = prev[0]?.n ?? 0;
  const log = (entry: { tool?: string; input?: unknown; output?: unknown; reasoning?: string }) =>
    query(
      `INSERT INTO agent_decisions (mandate_id, agent, step, tool, input, output, reasoning) VALUES ($1,'shopper',$2,$3,$4,$5,$6)`,
      [m.id, ++step, entry.tool ?? null, entry.input === undefined ? null : JSON.stringify(entry.input), entry.output === undefined ? null : JSON.stringify(entry.output), entry.reasoning ?? null],
    );
  const logged = <I, O>(name: string, fn: (input: I) => Promise<O> | O) => async (input: I) => {
    let output: unknown;
    try {
      output = await fn(input);
    } catch (err) {
      output = err instanceof MandateViolation ? { refused: err.message, check: err.check } : { error: (err as Error).message };
    }
    await log({ tool: name, input, output });
    return JSON.stringify(output);
  };

  if (overstep) {
    // Claude declines to break a mandate even when told to, so the misbehaving agent is simulated
    // by a fixed script (no model): a buggy third-party agent that buys a "close enough" item.
    await log({ reasoning: 'DEMO MODE: simulated misbehaving agent (scripted, not Claude). It skips the mandate check entirely, the way a buggy third-party shopping agent might.' });
    const hits = catalog.filter((i) => /usb-c|charg|power/i.test(`${i.name} ${i.category}`));
    await log({ tool: 'search_catalog', input: { query: 'usb-c charging' }, output: hits });
    const pick = findItem('pwr-bank-20k')!;
    await log({ reasoning: `Picked "${pick.name}" ($${pick.price.toFixed(2)}) because it charges over USB-C. Skipping check_mandate.` });
    const { purchase: p, check, captureStatus } = await purchase(m.id, pick.id, { overstep: true });
    await log({ tool: 'purchase', input: { item_id: pick.id }, output: { purchase_id: p.id, item: p.item_name, amount: p.amount, paypal_capture_id: p.capture_id, paypal_status: captureStatus, in_mandate: check.pass, mandate_check_it_skipped: check } });
    const t = await addTracking(p.id);
    await log({ tool: 'add_tracking', input: { purchase_id: p.id }, output: { carrier: t?.carrier, tracking_number: t?.tracking_number } });
    return { purchase: t ?? p, summary: `Scripted agent bought ${p.item_name} without checking the mandate.`, usage: { input: 0, output: 0 } };
  }

  const passed = new Set<string>();
  let bought: PurchaseRow | null = null;

  const tools = [
    betaZodTool({
      name: 'search_catalog',
      description: 'Search the store catalog. Returns matching items with id, name, category, price and delivery days.',
      inputSchema: z.object({ query: z.string().describe('Keywords, e.g. "usb-c charger 45W"') }),
      run: logged('search_catalog', ({ query: q }) => {
        const words = q.toLowerCase().split(/\W+/).filter(Boolean);
        const hits = catalog.filter((i) => words.some((w) => `${i.name} ${i.category}`.toLowerCase().includes(w)));
        return hits.length ? hits : catalog;
      }),
    }),
    betaZodTool({
      name: 'check_mandate',
      description: "Deterministically check whether buying an item now satisfies the shopper's mandate (category, currency, price limit, expiry, delivery date).",
      inputSchema: z.object({ item_id: z.string() }),
      run: logged('check_mandate', ({ item_id }) => {
        const item = findItem(item_id);
        if (!item) return { error: `Unknown item ${item_id}` };
        const result = checkMandate(m.rules, item);
        if (result.pass) passed.add(item_id);
        return { item: item.name, ...result };
      }),
    }),
    betaZodTool({
      name: 'purchase',
      description: "Buy one item, charging the shopper's PayPal authorization. Refused unless check_mandate passed for this item.",
      inputSchema: z.object({ item_id: z.string() }),
      run: logged('purchase', async ({ item_id }) => {
        if (bought) return { error: 'Already bought an item under this mandate.' };
        if (!passed.has(item_id)) return { refused: 'Call check_mandate for this item first; only items that pass can be bought.' };
        const { purchase: p, check, captureStatus } = await purchase(m.id, item_id);
        bought = p;
        return { purchase_id: p.id, item: p.item_name, amount: p.amount, paypal_capture_id: p.capture_id, paypal_status: captureStatus, in_mandate: check.pass };
      }),
    }),
    betaZodTool({
      name: 'add_tracking',
      description: 'Attach shipment tracking for a purchase to the PayPal order.',
      inputSchema: z.object({ purchase_id: z.string() }),
      run: logged('add_tracking', async ({ purchase_id }) => {
        const p = await addTracking(purchase_id);
        return { carrier: p?.carrier, tracking_number: p?.tracking_number };
      }),
    }),
  ];

  const runner = claude().beta.messages.toolRunner({
    model: MODEL,
    max_tokens: 16000,
    ...FALLBACK,
    output_config: { effort: 'low' },
    system: SYSTEM,
    tools,
    max_iterations: 12,
    messages: [
      {
        role: 'user',
        content: `Shopper's instructions: "${m.raw_text}"\nMandate rules: ${JSON.stringify(m.rules)}\nToday: ${new Date().toISOString()}`,
      },
    ],
  });

  const usage = { input: 0, output: 0 };
  let summary = '';
  for await (const message of runner) {
    usage.input += message.usage.input_tokens;
    usage.output += message.usage.output_tokens;
    const text = message.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('\n').trim();
    if (text) {
      summary = text;
      await log({ reasoning: text });
    }
  }
  return { purchase: bought as PurchaseRow | null, summary, usage };
}
