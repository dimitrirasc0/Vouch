// Mandates: the buyer's standing instructions to a shopping agent, made tamper-evident.
//
// Proof chain:
//   1. rules are canonicalised (sorted keys) and hashed with SHA-256
//   2. that hash is sent to PayPal as the order's custom_id, and a readable summary as the item
//      name, so PayPal's own record of the buyer's approval carries both
//   3. the hash is also HMAC-signed with MANDATE_SIGNING_SECRET so Vouch can detect local edits
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

export type MandateRules = {
  category: string; // catalog category the agent may buy from, e.g. "usb-c-charger"
  maxAmount: number; // per-purchase cap, in `currency`
  currency: string; // ISO 4217, e.g. "USD"
  expiresAt: string; // ISO timestamp after which the mandate is void
  deliverBy?: string; // optional ISO date the item must arrive by
  notes?: string; // free-text preferences ("prefer 65W+"); advisory, not enforced
};

export type CatalogItem = {
  id: string;
  name: string;
  category: string;
  price: number;
  currency: string;
  deliveryDays: number;
};

// Deterministic JSON: object keys sorted at every level, so the same rules always hash the same.
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export function hashRules(rules: MandateRules): string {
  return createHash('sha256').update(canonicalJson(rules)).digest('hex');
}

function secret(): string {
  const s = process.env.MANDATE_SIGNING_SECRET;
  if (!s) throw new Error('MANDATE_SIGNING_SECRET must be set (see .env)');
  return s;
}

export function signHash(hash: string): string {
  return createHmac('sha256', secret()).update(hash).digest('hex');
}

export type MandateVerification = {
  valid: boolean;
  hashMatches: boolean; // stored rules still hash to the stored hash
  signatureMatches: boolean; // stored hash carries our HMAC
  paypalMatches: boolean | null; // PayPal's custom_id equals the hash (null = not checked)
  computedHash: string;
};

export function verifyMandate(
  m: { rules: MandateRules; hash: string; signature: string },
  paypalCustomId?: string | null,
): MandateVerification {
  const computedHash = hashRules(m.rules);
  const hashMatches = computedHash === m.hash;
  const expected = Buffer.from(signHash(m.hash), 'hex');
  const given = Buffer.from(m.signature, 'hex');
  const signatureMatches = expected.length === given.length && timingSafeEqual(expected, given);
  const paypalMatches = paypalCustomId === undefined ? null : paypalCustomId === m.hash;
  return {
    valid: hashMatches && signatureMatches && paypalMatches !== false,
    hashMatches,
    signatureMatches,
    paypalMatches,
    computedHash,
  };
}

// One line, shown to the buyer in PayPal (item name limit is 127 chars).
export function summarize(r: MandateRules): string {
  const money = new Intl.NumberFormat('en-US', { style: 'currency', currency: r.currency }).format(r.maxAmount);
  const day = (iso: string) => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
  const label = r.category.replace(/usb-c/gi, 'USB-C').replace(/(?<!USB)-/g, ' ');
  const parts = [`Vouch mandate: ${label}`, `max ${money}`, `expires ${day(r.expiresAt)}`];
  if (r.deliverBy) parts.push(`arrive by ${day(r.deliverBy)}`);
  return parts.join(', ').slice(0, 127);
}

export type MandateCheck = { pass: boolean; checks: { rule: string; pass: boolean; detail: string }[] };

// Plain code, no model: does buying `item` now satisfy the mandate?
export function checkMandate(rules: MandateRules, item: CatalogItem, now = new Date()): MandateCheck {
  const checks = [
    { rule: 'category', pass: item.category === rules.category, detail: `item "${item.category}" vs mandate "${rules.category}"` },
    { rule: 'currency', pass: item.currency === rules.currency, detail: `${item.currency} vs ${rules.currency}` },
    { rule: 'maxAmount', pass: item.price <= rules.maxAmount, detail: `${item.price.toFixed(2)} <= ${rules.maxAmount.toFixed(2)}` },
    { rule: 'notExpired', pass: now < new Date(rules.expiresAt), detail: `now < ${rules.expiresAt}` },
  ];
  if (rules.deliverBy) {
    const eta = new Date(now.getTime() + item.deliveryDays * 86_400_000);
    checks.push({ rule: 'deliverBy', pass: eta <= new Date(rules.deliverBy), detail: `ETA ${eta.toISOString().slice(0, 10)} <= ${rules.deliverBy.slice(0, 10)}` });
  }
  return { pass: checks.every((c) => c.pass), checks };
}
