import Link from 'next/link';
import { connection } from 'next/server';
import { query } from '@/lib/db';
import { SyncButton } from './sync-button';

export const metadata = { title: 'Vouch' };

type Row = {
  id: string;
  reason: string | null;
  status: string | null;
  amount: string | null;
  outcome: string | null;
  verdict: string | null;
  action: string | null;
  confidence: string | null;
  submitted_at: string | null;
};

const REASON: Record<string, string> = {
  MERCHANDISE_OR_SERVICE_NOT_RECEIVED: 'Not received',
  MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED: 'Not as described',
};
const VERDICT: Record<string, string> = { IN_MANDATE: 'text-pp-success', OUT_OF_MANDATE: 'text-pp-danger', UNKNOWN: 'text-pp-warning' };

export default async function Home() {
  await connection();
  const disputes = await query<Row>(`
    SELECT d.id, d.reason, d.status, d.amount, d.outcome, r.verdict, r.action, r.confidence, r.submitted_at
    FROM disputes d
    LEFT JOIN LATERAL (SELECT * FROM recommendations WHERE dispute_id = d.id ORDER BY created_at DESC LIMIT 1) r ON true
    ORDER BY d.created_at DESC NULLS LAST`);
  const mandates = await query<{ id: string; summary: string; status: string }>(
    `SELECT id, summary, status FROM mandates WHERE status <> 'DRAFT' ORDER BY created_at DESC LIMIT 10`,
  );

  return (
    <main className="mx-auto w-full max-w-4xl px-4 py-12 font-paypal text-pp-ink sm:px-8">
      <p className="text-sm font-semibold uppercase tracking-wider text-pp-blue">Vouch</p>
      <div className="mt-1 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-[28px] font-semibold text-pp-navy">Disputes</h1>
        <div className="flex items-center gap-3">
          <SyncButton />
          <Link href="/dashboard" className="rounded-full border border-pp-border px-4 py-2 text-sm font-semibold text-pp-navy hover:bg-pp-highlight">
            Dashboard
          </Link>
          <Link href="/mandates/new" className="rounded-full bg-pp-blue px-4 py-2 text-sm font-semibold text-white hover:bg-pp-blue-dark">
            New mandate
          </Link>
        </div>
      </div>

      <ul className="mt-6 divide-y divide-pp-border rounded-xl border border-pp-border bg-pp-surface">
        {disputes.length === 0 && <li className="p-4 text-sm text-pp-muted">No disputes yet.</li>}
        {disputes.map((d) => (
          <li key={d.id}>
            <Link href={`/disputes/${d.id}`} className="flex flex-wrap items-center justify-between gap-3 p-4 hover:bg-pp-highlight">
              <div>
                <p className="font-semibold">
                  {REASON[d.reason ?? ''] ?? d.reason} · ${Number(d.amount).toFixed(2)}
                </p>
                <p className="text-xs text-pp-muted">
                  {d.id} · {d.outcome ? `resolved: ${d.outcome.toLowerCase().replaceAll('_', ' ')}` : d.status?.toLowerCase().replaceAll('_', ' ')}
                </p>
              </div>
              <p className="text-sm">
                {d.verdict ? (
                  <>
                    <span className={`font-semibold ${VERDICT[d.verdict]}`}>{d.verdict.replaceAll('_', ' ').toLowerCase()}</span>
                    <span className="text-pp-muted">
                      {' '}
                      → {d.action?.toLowerCase()} {d.confidence && `(${Math.round(Number(d.confidence) * 100)}%)`} {d.submitted_at ? '· submitted' : '· awaiting approval'}
                    </span>
                  </>
                ) : (
                  <span className="text-pp-muted">not investigated</span>
                )}
              </p>
            </Link>
          </li>
        ))}
      </ul>

      <h2 className="mt-10 text-sm font-semibold uppercase tracking-wider text-pp-muted">Mandates</h2>
      <ul className="mt-2 divide-y divide-pp-border rounded-xl border border-pp-border bg-pp-surface text-sm">
        {mandates.map((m) => (
          <li key={m.id} className="flex justify-between gap-3 p-3">
            <span>{m.summary}</span>
            <span className="text-pp-muted">{m.status.toLowerCase()}</span>
          </li>
        ))}
      </ul>
    </main>
  );
}
