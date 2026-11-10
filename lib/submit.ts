// Executes an approved recommendation against the PayPal Disputes API. Only called after the
// merchant clicks "Approve & submit" (human in the loop for anything that moves money).
import 'server-only';
import { one, query } from './db';
import { allowedActions, refreshDispute } from './disputes';
import { renderEvidencePdf } from './evidence-pdf';
import { getMandate } from './mandates';
import { paypalGet } from './paypal';
import type { PurchaseRow } from './purchases';

const BASE = 'https://api-m.sandbox.paypal.com';

export type RecommendationRow = {
  id: string;
  dispute_id: string;
  verdict: string;
  action: 'FIGHT' | 'OFFER' | 'ACCEPT';
  confidence: string | null;
  explanation: string | null;
  draft: string | null;
  offer_amount: string | null;
  evidence: {
    points?: string[];
    verification?: { hashMatches: boolean; signatureMatches: boolean; paypalMatches: boolean | null };
    recheck?: { checks: { rule: string; pass: boolean; detail: string }[] };
    purchase_id?: string;
    mandate_id?: string;
    tracking?: { carrier: string | null; number: string | null };
  } | null;
  approved_at: string | null;
  submitted_at: string | null;
  result: unknown;
  created_at: string;
};

export function latestRecommendation(disputeId: string) {
  return one<RecommendationRow>('SELECT * FROM recommendations WHERE dispute_id = $1 ORDER BY created_at DESC LIMIT 1', [disputeId]);
}

// The access token lives in lib/paypal.ts; multipart calls need raw fetch, so borrow it via a GET.
async function bearer(): Promise<string> {
  const { PAYPAL_CLIENT_ID: id } = process.env;
  const secret = process.env.PAYPAL_CLIENT_SECRET ?? process.env.PAYPAL_SECRET;
  const res = await fetch(`${BASE}/v1/oauth2/token`, {
    method: 'POST',
    headers: { Authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString('base64')}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=client_credentials',
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`PayPal OAuth ${res.status}`);
  return ((await res.json()) as { access_token: string }).access_token;
}

async function call(path: string, body: FormData | object) {
  const isForm = body instanceof FormData;
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${await bearer()}`, ...(isForm ? {} : { 'Content-Type': 'application/json' }) },
    body: isForm ? body : JSON.stringify(body),
    cache: 'no-store',
  });
  const text = await res.text();
  let parsed: unknown = text;
  try {
    parsed = text ? JSON.parse(text) : {};
  } catch {}
  return { ok: res.ok, status: res.status, body: parsed, debugId: res.headers.get('paypal-debug-id') };
}

async function evidencePdf(rec: RecommendationRow, note: string) {
  const ev = rec.evidence ?? {};
  const purchase = ev.purchase_id ? await one<PurchaseRow>('SELECT * FROM purchases WHERE id = $1', [ev.purchase_id]) : undefined;
  const mandate = ev.mandate_id ? await getMandate(ev.mandate_id) : undefined;
  if (!purchase || !mandate) return null;
  const order = mandate.order_id
    ? await paypalGet<{ purchase_units: { custom_id?: string }[] }>(`/v2/checkout/orders/${mandate.order_id}`)
    : undefined;
  return renderEvidencePdf({
    disputeId: rec.dispute_id,
    generatedAt: new Date().toISOString(),
    buyerInstructions: mandate.raw_text,
    rules: mandate.rules,
    summary: mandate.summary,
    fingerprint: mandate.hash,
    paypalOrderId: mandate.order_id,
    paypalCustomId: order?.purchase_units[0]?.custom_id ?? null,
    approvedAt: mandate.approved_at,
    approvedBy: mandate.buyer_email,
    authorizationId: mandate.authorization_id,
    purchase: { item: purchase.item_name, amount: purchase.amount, currency: purchase.currency, captureId: purchase.capture_id, boughtAt: purchase.created_at },
    tracking: { carrier: purchase.carrier, number: purchase.tracking_number },
    checks: ev.recheck?.checks ?? [],
    integrity: ev.verification ?? { hashMatches: false, signatureMatches: false, paypalMatches: null },
    points: ev.points ?? [note],
  });
}

export async function submitRecommendation(disputeId: string, opts: { note?: string; offerAmount?: number } = {}) {
  const rec = await latestRecommendation(disputeId);
  if (!rec) throw new Error('No recommendation to submit');
  if (rec.submitted_at) throw new Error('Already submitted');
  const note = (opts.note ?? rec.draft ?? '').slice(0, 2000);
  if (!note.trim()) throw new Error('Response note is empty');

  const dispute = await refreshDispute(disputeId);
  const can = allowedActions(dispute.raw);
  const amount = dispute.amount ?? '0';
  const currency = dispute.currency ?? 'USD';
  let result;

  if (rec.action === 'FIGHT') {
    if (!can.fight) throw new Error('PayPal currently allows neither evidence nor escalation on this dispute');
    const pdf = await evidencePdf(rec, note);
    const steps: { step: string; ok: boolean; status: number; body: unknown; debugId: string | null }[] = [];
    let evidenceAllowed = can.provide_evidence;

    if (!evidenceAllowed && dispute.stage === 'INQUIRY') {
      // 1. Put the evidence on the case record as a message to the buyer (best effort).
      if (can.send_message) {
        const form = new FormData();
        form.append('input', new Blob([JSON.stringify({ message: note })], { type: 'application/json' }));
        if (pdf) form.append('message_document', new Blob([Buffer.from(pdf)], { type: 'application/pdf' }), 'vouch_mandate_record.pdf');
        steps.push({ step: 'send_message', ...(await call(`/v1/customer/disputes/${disputeId}/send-message`, form)) });
      }
      // 2. Escalate the inquiry to a PayPal claim, with the case summary as the reason.
      steps.push({ step: 'escalate', ...(await call(`/v1/customer/disputes/${disputeId}/escalate`, { note })) });
      const after = await refreshDispute(disputeId);
      evidenceAllowed = allowedActions(after.raw).provide_evidence;
    }

    if (evidenceAllowed) {
      const tracking = rec.evidence?.tracking;
      const evidence: Record<string, unknown> = { evidence_type: 'PROOF_OF_FULFILLMENT', notes: note };
      if (tracking?.number) evidence.evidence_info = { tracking_info: [{ carrier_name: tracking.carrier ?? 'OTHER', tracking_number: tracking.number }] };
      if (pdf) evidence.documents = [{ name: 'vouch_mandate_record.pdf' }];
      const form = new FormData();
      form.append('input', new Blob([JSON.stringify({ evidences: [evidence] })], { type: 'application/json' }));
      if (pdf) form.append('file1', new Blob([Buffer.from(pdf)], { type: 'application/pdf' }), 'vouch_mandate_record.pdf');
      steps.push({ step: 'provide_evidence', ...(await call(`/v1/customer/disputes/${disputeId}/provide-evidence`, form)) });
    }
    const decisive = steps.filter((s) => s.step !== 'send_message');
    result = { ok: decisive.length > 0 && decisive.every((s) => s.ok), status: decisive.at(-1)?.status ?? 0, body: steps, debugId: null };
  } else if (rec.action === 'OFFER') {
    if (!can.make_offer) throw new Error('PayPal does not currently allow an offer on this dispute');
    const value = (opts.offerAmount ?? Number(rec.offer_amount ?? amount)).toFixed(2);
    result = await call(`/v1/customer/disputes/${disputeId}/make-offer`, {
      note,
      offer_type: 'REFUND',
      offer_amount: { currency_code: currency, value },
    });
  } else {
    if (!can.accept_claim) throw new Error('PayPal does not currently allow accepting this claim');
    result = await call(`/v1/customer/disputes/${disputeId}/accept-claim`, { note, accept_claim_type: 'REFUND' });
  }

  await query(
    `UPDATE recommendations SET approved_at = now(), submitted_at = CASE WHEN $2 THEN now() ELSE NULL END, result = $3, draft = $4 WHERE id = $1`,
    [rec.id, result.ok, JSON.stringify(result), note],
  );
  if (result.ok) await refreshDispute(disputeId).catch(() => {});
  return result;
}

// Sandbox only: ask PayPal to settle the dispute (requires status UNDER_REVIEW).
export async function adjudicate(disputeId: string, outcome: 'SELLER_FAVOR' | 'BUYER_FAVOR' = 'SELLER_FAVOR') {
  const result = await call(`/v1/customer/disputes/${disputeId}/adjudicate`, { adjudication_outcome: outcome });
  if (result.ok) await refreshDispute(disputeId).catch(() => {});
  return result;
}
