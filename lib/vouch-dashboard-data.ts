// Flat, related tables for the AG Studio dashboard, built from Vouch's database
// (which mirrors PayPal disputes and holds mandates, purchases and agent recommendations).
import 'server-only';
import { query } from './db';
import { verifyMandate, type MandateRules } from './mandate';

const REASON: Record<string, string> = {
  MERCHANDISE_OR_SERVICE_NOT_RECEIVED: 'Not received',
  MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED: 'Not as described',
  UNAUTHORISED: 'Unauthorized',
  INCORRECT_AMOUNT: 'Incorrect amount',
};
const VERDICT: Record<string, string> = { IN_MANDATE: 'In mandate', OUT_OF_MANDATE: 'Out of mandate', UNKNOWN: 'No mandate' };
const ACTION: Record<string, string> = { FIGHT: 'Fight', OFFER: 'Offer refund', ACCEPT: 'Accept' };
const day = (d: Date | string | null) => (d ? new Date(d).toISOString().slice(0, 10) : null);

export async function getVouchDashboardData(asOf = new Date()) {
  const rows = await query<{
    id: string; reason: string | null; status: string | null; stage: string | null; amount: string | null; currency: string | null;
    deadline: Date | null; outcome: string | null; created_at: Date | null; seller_txn_id: string | null;
    verdict: string | null; action: string | null; confidence: string | null; submitted_at: Date | null; mandate_id: string | null;
  }>(`
    SELECT d.id, d.reason, d.status, d.stage, d.amount, d.currency, d.deadline, d.outcome, d.created_at, d.seller_txn_id,
           r.verdict, r.action, r.confidence, r.submitted_at, p.mandate_id
    FROM disputes d
    LEFT JOIN LATERAL (SELECT * FROM recommendations WHERE dispute_id = d.id ORDER BY created_at DESC LIMIT 1) r ON true
    LEFT JOIN purchases p ON p.capture_id = d.seller_txn_id
    ORDER BY d.created_at DESC NULLS LAST`);

  const disputes = rows.map((d) => {
    const amount = Number(d.amount ?? 0);
    const won = d.outcome === 'RESOLVED_SELLER_FAVOUR';
    const lost = d.outcome === 'RESOLVED_BUYER_FAVOUR' || (d.action === 'ACCEPT' && !!d.submitted_at);
    const open = d.status !== 'RESOLVED';
    const result = won ? 'Won' : lost ? (d.action === 'ACCEPT' ? 'Refunded (agent fault)' : 'Lost') : open ? 'Open' : 'Closed';
    const daysLeft = d.deadline && open ? Math.ceil((new Date(d.deadline).getTime() - asOf.getTime()) / 86_400_000) : null;
    return {
      id: d.id,
      reason: REASON[d.reason ?? ''] ?? d.reason ?? 'Unknown',
      status: (d.status ?? '').replaceAll('_', ' ').toLowerCase(),
      stage: (d.stage ?? '').toLowerCase(),
      result,
      verdict: VERDICT[d.verdict ?? ''] ?? 'Not investigated',
      action: ACTION[d.action ?? ''] ?? '-',
      confidence: d.confidence ? Number(d.confidence) : null,
      submitted: !!d.submitted_at,
      mandateId: d.mandate_id,
      openedDate: day(d.created_at),
      deadline: day(d.deadline),
      daysLeft,
      currency: d.currency ?? 'USD',
      amount,
      atRisk: open && !lost ? amount : 0,
      recovered: won ? amount : 0,
      refunded: lost ? amount : 0,
      decided: won || lost ? 1 : 0,
      wonCount: won ? 1 : 0,
      disputeCount: 1,
      mandateBacked: d.mandate_id ? 1 : 0,
      inMandate: d.verdict === 'IN_MANDATE' ? 1 : 0,
    };
  });

  const mandateRows = await query<{
    id: string; rules: MandateRules; summary: string; hash: string; signature: string; status: string; approved_at: Date | null; buyer_email: string | null;
  }>(`SELECT id, rules, summary, hash, signature, status, approved_at, buyer_email FROM mandates WHERE status <> 'DRAFT' ORDER BY created_at DESC`);
  const mandates = mandateRows.map((m) => {
    const v = verifyMandate(m);
    return {
      id: m.id,
      summary: m.summary,
      category: m.rules.category,
      maxAmount: m.rules.maxAmount,
      status: m.status.toLowerCase(),
      approvedDate: day(m.approved_at),
      expiresDate: day(m.rules.expiresAt),
      buyer: m.buyer_email ?? '-',
      signatureValid: v.hashMatches && v.signatureMatches,
    };
  });

  const purchaseRows = await query<{ id: string; mandate_id: string; item_name: string; category: string | null; amount: string; in_mandate: boolean | null; created_at: Date; tracking_number: string | null }>(
    `SELECT id, mandate_id, item_name, category, amount, in_mandate, created_at, tracking_number FROM purchases ORDER BY created_at DESC`,
  );
  const purchases = purchaseRows.map((p) => ({
    id: p.id,
    mandateId: p.mandate_id,
    item: p.item_name,
    category: p.category ?? '-',
    amount: Number(p.amount),
    withinMandate: p.in_mandate ? 'Within mandate' : 'Outside mandate',
    date: day(p.created_at),
    tracked: !!p.tracking_number,
    purchaseCount: 1,
  }));

  return { asOf: asOf.toISOString(), disputes, mandates, purchases };
}

export type VouchDashboardData = Awaited<ReturnType<typeof getVouchDashboardData>>;
