// The dispute agent. Claude investigates with read-only tools; the verdict is computed in code;
// Claude then writes the explanation and the response to PayPal. Nothing here moves money:
// submission happens only after the merchant approves (see app/api/disputes/[id]/submit).
import 'server-only';
import { z } from 'zod';
import { betaZodTool } from '@anthropic-ai/sdk/helpers/beta/zod';
import { claude, FALLBACK, MODEL } from '../claude';
import { one, query } from '../db';
import { allowedActions, refreshDispute, type DisputeRow, type PayPalDispute } from '../disputes';
import { findItem } from '../catalog';
import { checkMandate, verifyMandate, type MandateCheck, type MandateVerification } from '../mandate';
import { getMandate, type MandateRow } from '../mandates';
import { paypalGet } from '../paypal';
import type { PurchaseRow } from '../purchases';

export type Verdict = 'IN_MANDATE' | 'OUT_OF_MANDATE' | 'UNKNOWN';
export type Action = 'FIGHT' | 'OFFER' | 'ACCEPT';

type Facts = {
  dispute: DisputeRow;
  purchase?: PurchaseRow;
  mandate?: MandateRow;
  verification?: MandateVerification;
  recheck?: MandateCheck;
  paypalOrder?: { custom_id?: string; item_name?: string };
};

// ---------- deterministic core ----------

async function gatherFacts(disputeId: string): Promise<Facts> {
  const dispute = await refreshDispute(disputeId);
  const purchase = dispute.seller_txn_id
    ? await one<PurchaseRow>('SELECT * FROM purchases WHERE capture_id = $1', [dispute.seller_txn_id])
    : undefined;
  if (!purchase) return { dispute };

  const mandate = await getMandate(purchase.mandate_id);
  if (!mandate) return { dispute, purchase };

  let paypalOrder: Facts['paypalOrder'];
  if (mandate.order_id) {
    const order = await paypalGet<{ purchase_units: { custom_id?: string; items?: { name: string }[] }[] }>(
      `/v2/checkout/orders/${mandate.order_id}`,
    );
    paypalOrder = { custom_id: order.purchase_units[0]?.custom_id, item_name: order.purchase_units[0]?.items?.[0]?.name };
  }
  const verification = verifyMandate(mandate, paypalOrder?.custom_id ?? null);
  const item = findItem(purchase.item_id);
  // Re-run the rule check as of the moment of purchase, from the catalog entry that was bought.
  const recheck = item ? checkMandate(mandate.rules, item, new Date(purchase.created_at)) : undefined;
  return { dispute, purchase, mandate, verification, recheck, paypalOrder };
}

export function computeVerdict(f: Facts): { verdict: Verdict; action: Action | null; confidence: number | null; why: string } {
  if (!f.purchase || !f.mandate) return { verdict: 'UNKNOWN', action: null, confidence: null, why: 'No agent purchase or mandate is linked to this transaction.' };
  if (!f.verification?.valid) return { verdict: 'UNKNOWN', action: null, confidence: null, why: 'Mandate record failed integrity verification, so it cannot be used as evidence.' };
  if (!f.recheck) return { verdict: 'UNKNOWN', action: null, confidence: null, why: 'Purchased item is no longer in the catalog to re-check.' };
  if (!f.recheck.pass) {
    const broken = f.recheck.checks.filter((c) => !c.pass).map((c) => c.rule).join(', ');
    return { verdict: 'OUT_OF_MANDATE', action: 'ACCEPT', confidence: 0.92, why: `Purchase broke the mandate (${broken}); the buyer's claim is valid.` };
  }
  let confidence = 0.55;
  if (f.verification.paypalMatches) confidence += 0.2; // PayPal's own record carries the mandate hash
  if (f.purchase.tracking_number) confidence += 0.12;
  if (f.mandate.approved_at) confidence += 0.05;
  return { verdict: 'IN_MANDATE', action: 'FIGHT', confidence: Math.min(0.95, Number(confidence.toFixed(2))), why: 'Purchase satisfied every rule of a mandate the buyer approved in PayPal.' };
}

// ---------- logging ----------

async function log(disputeId: string, step: number, entry: { tool?: string; input?: unknown; output?: unknown; reasoning?: string }) {
  await query(
    `INSERT INTO agent_decisions (dispute_id, agent, step, tool, input, output, reasoning) VALUES ($1,'dispute',$2,$3,$4,$5,$6)`,
    [disputeId, step, entry.tool ?? null, entry.input === undefined ? null : JSON.stringify(entry.input), entry.output === undefined ? null : JSON.stringify(entry.output), entry.reasoning ?? null],
  );
}

// ---------- the agent ----------

const SYSTEM = `You are Vouch's dispute agent, working for a small online merchant whose customers shop through AI agents.
Each purchase an agent makes is bound by a "mandate": rules the buyer approved in PayPal (category, spending limit, expiry, delivery date). The mandate's SHA-256 fingerprint is stored on the PayPal order as custom_id, so PayPal's own record proves which mandate the buyer approved.

Your job for one PayPal dispute:
1. Investigate with the tools: read the dispute and the buyer's message, find the purchase and mandate behind the transaction, verify the mandate, check the purchase against it, and look at tracking and the shopping agent's decision trail.
2. Call get_verdict. The verdict and, for mandate cases, the action are decided by deterministic code. Do not argue with them.
3. Call record_recommendation exactly once, then stop.

Writing rules:
- explanation: 2-4 plain sentences for the merchant: what the buyer claims, what the evidence shows, and why the action follows.
- response_to_paypal: the note submitted to PayPal with the evidence (for FIGHT) or with the offer/acceptance. Factual, polite, specific: cite the mandate rules, the buyer's approval in PayPal, the order custom_id fingerprint, item, price, delivery dates and tracking. No speculation about the buyer's motives. Under 1800 characters.
- evidence_points: short factual bullets, each one checkable from the tool results.
- Only state facts that appear in tool results. If something is missing, say so.
- If the verdict is UNKNOWN, choose the action yourself from the actions PayPal allows, weighing the merchant's evidence honestly; a partial refund (OFFER) is reasonable when evidence is weak but not absent.`;

export async function runDisputeAgent(disputeId: string) {
  const facts = await gatherFacts(disputeId);
  const verdict = computeVerdict(facts);
  const allowed = allowedActions(facts.dispute.raw);
  let step = 0;
  let recorded: z.infer<typeof RecordInput> | null = null;

  const logged = <I, O>(name: string, fn: (input: I) => Promise<O> | O) => async (input: I) => {
    const output = await fn(input);
    await log(disputeId, ++step, { tool: name, input, output });
    return JSON.stringify(output);
  };

  const d: PayPalDispute = facts.dispute.raw;
  const tools = [
    betaZodTool({
      name: 'get_dispute',
      description: 'The PayPal dispute: reason, status, amount, deadline, disputed items and the messages exchanged.',
      inputSchema: z.object({}),
      run: logged('get_dispute', () => ({
        dispute_id: d.dispute_id,
        reason: d.reason,
        status: d.status,
        stage: d.dispute_life_cycle_stage,
        amount: d.dispute_amount,
        seller_response_due: d.seller_response_due_date,
        seller_transaction_id: facts.dispute.seller_txn_id,
        items: (d.disputed_transactions as { items?: unknown[] }[] | undefined)?.[0]?.items,
        messages: (d.messages as { posted_by: string; time_posted: string; content: string }[] | undefined)?.map((m) => ({
          from: m.posted_by,
          at: m.time_posted,
          text: m.content,
        })),
      })),
    }),
    betaZodTool({
      name: 'get_purchase_for_transaction',
      description: "Find the agent purchase and its mandate for the dispute's seller transaction id.",
      inputSchema: z.object({ seller_transaction_id: z.string() }),
      run: logged('get_purchase_for_transaction', async ({ seller_transaction_id }) => {
        if (seller_transaction_id !== facts.dispute.seller_txn_id) return { error: 'Transaction id does not belong to this dispute.' };
        if (!facts.purchase) return { found: false };
        const m = facts.mandate;
        return {
          found: true,
          purchase: { id: facts.purchase.id, item: facts.purchase.item_name, category: facts.purchase.category, amount: facts.purchase.amount, currency: facts.purchase.currency, bought_at: facts.purchase.created_at },
          mandate: m && { id: m.id, buyer_instructions: m.raw_text, rules: m.rules, summary: m.summary, approved_in_paypal_at: m.approved_at, approved_by: m.buyer_email, paypal_order_id: m.order_id, paypal_authorization_id: m.authorization_id },
        };
      }),
    }),
    betaZodTool({
      name: 'verify_mandate',
      description: "Check the mandate's integrity: rules still hash to the stored fingerprint, Vouch's HMAC signature is valid, and PayPal's order custom_id equals the fingerprint.",
      inputSchema: z.object({ mandate_id: z.string() }),
      run: logged('verify_mandate', ({ mandate_id }) =>
        facts.mandate?.id !== mandate_id
          ? { error: 'Unknown mandate for this dispute.' }
          : { ...facts.verification, stored_fingerprint: facts.mandate.hash, paypal_order_custom_id: facts.paypalOrder?.custom_id, paypal_order_item_name: facts.paypalOrder?.item_name },
      ),
    }),
    betaZodTool({
      name: 'check_purchase_against_mandate',
      description: 'Re-run the deterministic rule check (category, currency, price limit, expiry, delivery date) as of the time of purchase.',
      inputSchema: z.object({ purchase_id: z.string() }),
      run: logged('check_purchase_against_mandate', ({ purchase_id }) =>
        facts.purchase?.id !== purchase_id ? { error: 'Unknown purchase for this dispute.' } : (facts.recheck ?? { error: 'Item not in catalog' }),
      ),
    }),
    betaZodTool({
      name: 'get_tracking',
      description: 'Shipment tracking recorded on the PayPal order for this purchase.',
      inputSchema: z.object({ purchase_id: z.string() }),
      run: logged('get_tracking', ({ purchase_id }) =>
        facts.purchase?.id !== purchase_id
          ? { error: 'Unknown purchase for this dispute.' }
          : { carrier: facts.purchase.carrier, tracking_number: facts.purchase.tracking_number, expected_delivery_days: findItem(facts.purchase.item_id)?.deliveryDays },
      ),
    }),
    betaZodTool({
      name: 'get_decision_trail',
      description: "The shopping agent's logged steps when it made this purchase.",
      inputSchema: z.object({ mandate_id: z.string() }),
      run: logged('get_decision_trail', async ({ mandate_id }) => {
        const rows = await query<{ step: number; tool: string | null; reasoning: string | null; output: unknown }>(
          `SELECT step, tool, reasoning, output FROM agent_decisions WHERE mandate_id = $1 AND agent = 'shopper' ORDER BY step`,
          [mandate_id],
        );
        return rows.length ? rows : { note: 'No shopping-agent trail recorded (purchase was made directly).' };
      }),
    }),
    betaZodTool({
      name: 'get_verdict',
      description: 'The deterministic verdict and required action, plus the response actions PayPal currently allows.',
      inputSchema: z.object({}),
      run: logged('get_verdict', () => ({ ...verdict, paypal_allows: allowed })),
    }),
    betaZodTool({
      name: 'record_recommendation',
      description: 'Record your final recommendation for the merchant to review. Call exactly once.',
      inputSchema: RecordInput,
      run: async (input) => {
        if (verdict.action && input.action !== verdict.action) return `Rejected: the verdict requires action ${verdict.action}.`;
        const can = { FIGHT: allowed.provide_evidence, OFFER: allowed.make_offer, ACCEPT: allowed.accept_claim }[input.action];
        if (!can) return `Rejected: PayPal does not currently allow ${input.action} on this dispute.`;
        recorded = input;
        await log(disputeId, ++step, { tool: 'record_recommendation', input });
        return 'Recorded.';
      },
    }),
  ];

  const runner = claude().beta.messages.toolRunner({
    model: MODEL,
    max_tokens: 16000,
    ...FALLBACK,
    thinking: { type: 'adaptive', display: 'summarized' },
    output_config: { effort: 'medium' },
    system: SYSTEM,
    tools,
    max_iterations: 14,
    messages: [{ role: 'user', content: `Investigate PayPal dispute ${disputeId} and record your recommendation.` }],
  });

  const usage = { input: 0, output: 0 };
  for await (const message of runner) {
    usage.input += message.usage.input_tokens;
    usage.output += message.usage.output_tokens;
    const thoughts = message.content
      .map((b) => (b.type === 'thinking' ? b.thinking : b.type === 'text' ? b.text : ''))
      .filter((t) => t.trim())
      .join('\n\n');
    if (thoughts) await log(disputeId, ++step, { reasoning: thoughts });
  }

  const rec = recorded as z.infer<typeof RecordInput> | null;
  if (!rec) throw new Error('Agent finished without recording a recommendation');

  const row = await one<{ id: string }>(
    `INSERT INTO recommendations (dispute_id, verdict, action, confidence, explanation, draft, offer_amount, evidence)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
    [
      disputeId,
      verdict.verdict,
      rec.action,
      verdict.confidence ?? rec.confidence,
      rec.explanation,
      rec.response_to_paypal,
      rec.action === 'OFFER' ? rec.offer_amount : null,
      JSON.stringify({
        points: rec.evidence_points,
        verdict_reason: verdict.why,
        verification: facts.verification,
        recheck: facts.recheck,
        purchase_id: facts.purchase?.id,
        mandate_id: facts.mandate?.id,
        tracking: facts.purchase && { carrier: facts.purchase.carrier, number: facts.purchase.tracking_number },
      }),
    ],
  );
  return { recommendationId: row!.id, verdict, recommendation: rec, usage };
}

const RecordInput = z.object({
  action: z.enum(['FIGHT', 'OFFER', 'ACCEPT']),
  explanation: z.string(),
  response_to_paypal: z.string(),
  evidence_points: z.array(z.string()),
  offer_amount: z.number().nullable().describe('Refund amount for OFFER, otherwise null'),
  confidence: z.number().describe('0-1. Only used when the verdict is UNKNOWN; otherwise the code-computed confidence applies.'),
});
