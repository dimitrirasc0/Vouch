// Buying against a mandate: deterministic rule check, then capture from the buyer's authorization.
import 'server-only';
import { randomBytes } from 'node:crypto';
import { one, query } from './db';
import { findItem } from './catalog';
import { checkMandate, type MandateCheck } from './mandate';
import { getMandate } from './mandates';
import { paypalPost } from './paypal';

export type PurchaseRow = {
  id: string;
  mandate_id: string;
  item_id: string;
  item_name: string;
  category: string | null;
  amount: string;
  currency: string;
  capture_id: string | null;
  in_mandate: boolean | null;
  tracking_number: string | null;
  carrier: string | null;
  created_at: string;
  source?: string | null; // null = web app, "mcp" = external agent via /api/mcp
};

export class MandateViolation extends Error {
  constructor(readonly check: MandateCheck) {
    super(`Purchase blocked by mandate: ${check.checks.filter((c) => !c.pass).map((c) => c.rule).join(', ')}`);
  }
}

// `overstep` is the clearly labelled demo switch: it skips enforcement so we can show what Vouch
// does when an agent buys outside its mandate. The check still runs and is recorded.
export async function purchase(mandateId: string, itemId: string, { overstep = false } = {}) {
  const m = await getMandate(mandateId);
  if (!m) throw new Error('Mandate not found');
  if (m.status !== 'AUTHORIZED' || !m.authorization_id || !m.order_id) throw new Error(`Mandate is ${m.status}, not AUTHORIZED`);
  const item = findItem(itemId);
  if (!item) throw new Error(`Unknown item ${itemId}`);

  const check = checkMandate(m.rules, item);
  if (!check.pass && !overstep) throw new MandateViolation(check);

  const id = `pur_${randomBytes(6).toString('hex')}`;
  const value = item.price.toFixed(2);
  const capture = await paypalPost<{ id: string; status: string }>(`/v2/payments/authorizations/${m.authorization_id}/capture`, {
    amount: { currency_code: item.currency, value },
    final_capture: true,
    invoice_id: id,
    note_to_payer: `${item.name}. Bought by your Vouch agent under mandate ${m.id}.`.slice(0, 255),
  });

  const row = await one<PurchaseRow>(
    `INSERT INTO purchases (id, mandate_id, item_id, item_name, category, amount, currency, capture_id, in_mandate)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
    [id, m.id, item.id, item.name, item.category, value, item.currency, capture.id, check.pass],
  );
  await query(`UPDATE mandates SET status = 'USED' WHERE id = $1`, [m.id]);
  return { purchase: row!, check, captureStatus: capture.status };
}

// Adds a (sandbox) shipment to the PayPal order so tracking exists as dispute evidence.
export async function addTracking(purchaseId: string, carrier = 'USPS') {
  const p = await one<PurchaseRow & { order_id: string }>(
    `SELECT p.*, m.order_id FROM purchases p JOIN mandates m ON m.id = p.mandate_id WHERE p.id = $1`,
    [purchaseId],
  );
  if (!p?.capture_id) throw new Error('Purchase not found or not captured');
  const tracking = `9400${Math.floor(Math.random() * 1e18).toString().padStart(18, '0')}`;
  await paypalPost(`/v2/checkout/orders/${p.order_id}/track`, {
    capture_id: p.capture_id,
    tracking_number: tracking,
    carrier,
    notify_payer: false,
  });
  return one<PurchaseRow>(`UPDATE purchases SET tracking_number = $2, carrier = $3 WHERE id = $1 RETURNING *`, [p.id, tracking, carrier]);
}

export function purchaseByCapture(captureId: string) {
  return one<PurchaseRow>('SELECT * FROM purchases WHERE capture_id = $1', [captureId]);
}
