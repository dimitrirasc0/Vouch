// Mandate persistence + the two PayPal steps (create AUTHORIZE order, authorize after approval).
import 'server-only';
import { randomBytes } from 'node:crypto';
import { one, query } from './db';
import { hashRules, signHash, summarize, type MandateRules } from './mandate';
import { paypalGet, paypalPost } from './paypal';

export type MandateRow = {
  id: string;
  raw_text: string;
  rules: MandateRules;
  summary: string;
  hash: string;
  signature: string;
  order_id: string | null;
  authorization_id: string | null;
  buyer_email: string | null;
  approved_at: string | null;
  status: string;
  created_at: string;
};

export async function createMandate(rawText: string, rules: MandateRules): Promise<MandateRow> {
  const id = `mdt_${randomBytes(6).toString('hex')}`;
  const hash = hashRules(rules);
  const row = await one<MandateRow>(
    `INSERT INTO mandates (id, raw_text, rules, summary, hash, signature)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
    [id, rawText, rules, summarize(rules), hash, signHash(hash)],
  );
  return row!;
}

export function getMandate(id: string): Promise<MandateRow | undefined> {
  return one<MandateRow>('SELECT * FROM mandates WHERE id = $1', [id]);
}

export function listMandates(): Promise<MandateRow[]> {
  return query<MandateRow>('SELECT * FROM mandates ORDER BY created_at DESC');
}

const money = (n: number) => n.toFixed(2);

// The order the buyer approves. Its custom_id carries the mandate hash and its single line item
// is the human-readable mandate, which PayPal shows in the buyer's own activity record.
export async function createMandateOrder(m: MandateRow): Promise<string> {
  const value = money(m.rules.maxAmount);
  const currency_code = m.rules.currency;
  const order = await paypalPost<{ id: string }>('/v2/checkout/orders', {
    intent: 'AUTHORIZE',
    purchase_units: [
      {
        reference_id: m.id,
        custom_id: m.hash,
        description: m.summary,
        amount: { currency_code, value, breakdown: { item_total: { currency_code, value } } },
        items: [{ name: m.summary, quantity: '1', unit_amount: { currency_code, value } }],
      },
    ],
    payment_source: {
      paypal: {
        experience_context: { brand_name: 'Vouch', shipping_preference: 'NO_SHIPPING', user_action: 'CONTINUE' },
      },
    },
  });
  await query(`UPDATE mandates SET order_id = $2 WHERE id = $1`, [m.id, order.id]);
  return order.id;
}

type OrderDetails = {
  id: string;
  status: string;
  payer?: { email_address?: string };
  purchase_units: {
    custom_id?: string;
    payments?: { authorizations?: { id: string; status: string; expiration_time?: string; custom_id?: string }[] };
  }[];
};

// Called after the buyer approves in the PayPal popup. Refuses if the order isn't this mandate's.
export async function authorizeMandate(m: MandateRow, orderId: string): Promise<MandateRow> {
  if (m.order_id !== orderId) throw new Error(`Order ${orderId} does not belong to mandate ${m.id}`);
  const before = await paypalGet<OrderDetails>(`/v2/checkout/orders/${orderId}`);
  if (before.purchase_units[0]?.custom_id !== m.hash) throw new Error('PayPal order custom_id does not match mandate hash');

  const order = await paypalPost<OrderDetails>(`/v2/checkout/orders/${orderId}/authorize`, {}, { idempotent: false });
  const auth = order.purchase_units[0]?.payments?.authorizations?.[0];
  if (!auth) throw new Error('PayPal returned no authorization');

  const row = await one<MandateRow>(
    `UPDATE mandates SET authorization_id = $2, buyer_email = $3, approved_at = now(), status = 'AUTHORIZED'
     WHERE id = $1 RETURNING *`,
    [m.id, auth.id, order.payer?.email_address ?? before.payer?.email_address ?? null],
  );
  return row!;
}
