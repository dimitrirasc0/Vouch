import Link from 'next/link';
import { connection } from 'next/server';
import { query } from '@/lib/db';
import { SiteNav } from '../site-nav';

export const metadata = { title: 'Mandates' };

type Row = {
  id: string;
  summary: string;
  status: string;
  approved_at: Date | null;
  item_name: string | null;
  amount: string | null;
  in_mandate: boolean | null;
  dispute_id: string | null;
  source: string | null;
  source_client: string | null;
};

const STATUS: Record<string, { label: string; cls: string }> = {
  DRAFT: { label: 'Not approved yet', cls: 'bg-pp-canvas text-pp-muted' },
  AUTHORIZED: { label: 'Approved · ready for agent', cls: 'bg-pp-highlight text-pp-blue' },
  USED: { label: 'Purchase made', cls: 'bg-pp-success/10 text-pp-success' },
};

export default async function MandatesPage() {
  await connection();
  const rows = await query<Row>(`
    SELECT m.id, m.summary, m.status, m.approved_at, m.source, m.source_client, p.item_name, p.amount, p.in_mandate, d.id AS dispute_id
    FROM mandates m
    LEFT JOIN purchases p ON p.mandate_id = m.id
    LEFT JOIN disputes d ON d.seller_txn_id = p.capture_id
    ORDER BY m.created_at DESC`);
  // Drafts that were never approved are noise; show only the latest few.
  const drafts = rows.filter((r) => r.status === 'DRAFT').slice(0, 3);
  const shown = [...rows.filter((r) => r.status !== 'DRAFT'), ...drafts];

  return (
    <>
      <SiteNav />
      <main className="mx-auto w-full max-w-5xl px-4 py-10 font-paypal text-pp-ink sm:px-8">
        <h1 className="text-[28px] font-semibold text-pp-navy">Mandates</h1>
        <p className="mt-1 text-pp-muted">What each shopping agent was allowed to buy, what it bought, and whether that purchase was disputed.</p>
        <ul className="mt-6 divide-y divide-pp-border rounded-xl border border-pp-border bg-pp-surface">
          {shown.length === 0 && <li className="p-4 text-sm text-pp-muted">No mandates yet.</li>}
          {shown.map((m) => {
            const s = STATUS[m.status] ?? { label: m.status.toLowerCase(), cls: 'bg-pp-canvas text-pp-muted' };
            return (
              <li key={m.id} className="flex flex-wrap items-center justify-between gap-3 p-4">
                <Link href={`/mandates/${m.id}`} className="min-w-0 flex-1 hover:text-pp-blue">
                  <p className="font-semibold">{m.summary}</p>
                  <p className="mt-0.5 text-xs text-pp-muted">
                    {m.id}
                    {m.item_name && (
                      <>
                        {' '}· bought {m.item_name} for ${Number(m.amount).toFixed(2)}{' '}
                        <span className={m.in_mandate ? 'text-pp-success' : 'text-pp-danger'}>({m.in_mandate ? 'within mandate' : 'outside mandate'})</span>
                      </>
                    )}
                  </p>
                </Link>
                <div className="flex items-center gap-2">
                  {m.source === 'mcp' && (
                    <span className="rounded-full bg-pp-navy px-2.5 py-1 text-xs font-semibold text-white">via MCP{m.source_client ? ` · ${m.source_client}` : ''}</span>
                  )}
                  <span className={`rounded-full px-3 py-1 text-xs font-semibold ${s.cls}`}>{s.label}</span>
                  {m.dispute_id && (
                    <Link href={`/disputes/${m.dispute_id}`} className="rounded-full bg-pp-danger/10 px-3 py-1 text-xs font-semibold text-pp-danger hover:underline">
                      Disputed →
                    </Link>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      </main>
    </>
  );
}
