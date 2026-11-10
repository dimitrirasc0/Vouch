// Disputes: PayPal is the source of truth; we keep a local copy for the dashboard and agent.
import 'server-only';
import { one, query } from './db';
import { paypalGet } from './paypal';

type Money = { currency_code: string; value: string };
export type PayPalDispute = {
  dispute_id: string;
  create_time?: string;
  update_time?: string;
  reason?: string;
  status?: string;
  dispute_life_cycle_stage?: string;
  dispute_amount?: Money;
  seller_response_due_date?: string;
  dispute_outcome?: { outcome_code?: string; amount_refunded?: Money };
  disputed_transactions?: { seller_transaction_id?: string; buyer_transaction_id?: string }[];
  links?: { rel: string; href: string; method: string }[];
  [key: string]: unknown;
};

export type DisputeRow = {
  id: string;
  seller_txn_id: string | null;
  buyer_txn_id: string | null;
  reason: string | null;
  status: string | null;
  stage: string | null;
  amount: string | null;
  currency: string | null;
  deadline: string | null;
  outcome: string | null;
  raw: PayPalDispute;
  created_at: string | null;
  updated_at: string;
};

export function fetchDispute(id: string): Promise<PayPalDispute> {
  return paypalGet<PayPalDispute>(`/v1/customer/disputes/${encodeURIComponent(id)}`);
}

export async function upsertDispute(d: PayPalDispute): Promise<DisputeRow> {
  const txn = d.disputed_transactions?.[0];
  const row = await one<DisputeRow>(
    `INSERT INTO disputes (id, seller_txn_id, buyer_txn_id, reason, status, stage, amount, currency, deadline, outcome, raw, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12, now())
     ON CONFLICT (id) DO UPDATE SET
       seller_txn_id = EXCLUDED.seller_txn_id, buyer_txn_id = EXCLUDED.buyer_txn_id, reason = EXCLUDED.reason,
       status = EXCLUDED.status, stage = EXCLUDED.stage, amount = EXCLUDED.amount, currency = EXCLUDED.currency,
       deadline = EXCLUDED.deadline, outcome = EXCLUDED.outcome, raw = EXCLUDED.raw, updated_at = now()
     RETURNING *`,
    [
      d.dispute_id,
      txn?.seller_transaction_id ?? null,
      txn?.buyer_transaction_id ?? null,
      d.reason ?? null,
      d.status ?? null,
      d.dispute_life_cycle_stage ?? null,
      d.dispute_amount?.value ?? null,
      d.dispute_amount?.currency_code ?? null,
      d.seller_response_due_date ?? null,
      d.dispute_outcome?.outcome_code ?? null,
      d,
      d.create_time ?? null,
    ],
  );
  return row!;
}

// Pull fresh state from PayPal (webhook payloads can arrive late and out of order, so we never
// trust their snapshot) and store it.
export async function refreshDispute(id: string): Promise<DisputeRow> {
  return upsertDispute(await fetchDispute(id));
}

// Fallback for late sandbox webhooks: list every dispute and refresh each one.
export async function syncDisputes(): Promise<DisputeRow[]> {
  const out: DisputeRow[] = [];
  let path: string | null = '/v1/customer/disputes?page_size=50';
  while (path) {
    const page: { items?: { dispute_id: string }[]; links?: { rel: string; href: string }[] } = await paypalGet(path);
    for (const item of page.items ?? []) out.push(await refreshDispute(item.dispute_id));
    const next = page.links?.find((l) => l.rel === 'next')?.href;
    path = next ? next.replace(/^https:\/\/api-m\.(sandbox\.)?paypal\.com/, '') : null;
  }
  return out;
}

export function getDisputeRow(id: string) {
  return one<DisputeRow>('SELECT * FROM disputes WHERE id = $1', [id]);
}

export function listDisputes() {
  return query<DisputeRow>('SELECT * FROM disputes ORDER BY created_at DESC NULLS LAST');
}

// What PayPal will currently accept from the merchant, from HATEOAS links + allowed_response_options.
export function allowedActions(d: PayPalDispute) {
  const rels = new Set((d.links ?? []).map((l) => l.rel));
  return {
    // FIGHT is possible by uploading evidence, or (in INQUIRY) by escalating to a PayPal claim.
    fight: rels.has('provide_evidence') || rels.has('escalate'),
    provide_evidence: rels.has('provide_evidence'),
    make_offer: rels.has('make_offer'),
    accept_claim: rels.has('accept_claim'),
    send_message: rels.has('send_message'),
    escalate: rels.has('escalate'),
    adjudicate: rels.has('adjudicate'), // sandbox only
    options: (d.allowed_response_options as Record<string, unknown> | undefined) ?? {},
  };
}
