import Link from 'next/link';
import { notFound } from 'next/navigation';
import { connection } from 'next/server';
import { query } from '@/lib/db';
import { verifyMandate } from '@/lib/mandate';
import { getMandate } from '@/lib/mandates';
import { paypalGet } from '@/lib/paypal';
import type { PurchaseRow } from '@/lib/purchases';
import { RunShopper } from './run-shopper';

export async function generateMetadata({ params }: PageProps<'/mandates/[id]'>) {
  return { title: `Mandate ${(await params).id}` };
}

const fmt = (d: string | Date | null) =>
  d ? new Date(d).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'UTC', timeZoneName: 'short' }) : '-';

export default async function Page({ params }: PageProps<'/mandates/[id]'>) {
  await connection();
  const { id } = await params;
  const m = await getMandate(id);
  if (!m) notFound();

  let customId: string | null | undefined;
  if (m.order_id) {
    const order = await paypalGet<{ purchase_units: { custom_id?: string }[] }>(`/v2/checkout/orders/${m.order_id}`).catch(() => null);
    customId = order?.purchase_units[0]?.custom_id ?? null;
  }
  const v = verifyMandate(m, customId);
  const purchases = await query<PurchaseRow>('SELECT * FROM purchases WHERE mandate_id = $1 ORDER BY created_at', [m.id]);
  const trail = await query<{ id: string; step: number; tool: string | null; input: unknown; output: unknown; reasoning: string | null }>(
    `SELECT id, step, tool, input, output, reasoning FROM agent_decisions WHERE mandate_id = $1 AND agent = 'shopper' ORDER BY id`,
    [m.id],
  );
  const badge = (ok: boolean | null, label: string) => (
    <span className={`rounded-full px-3 py-1 text-xs font-semibold ${ok === null ? 'bg-pp-canvas text-pp-muted' : ok ? 'bg-pp-success/10 text-pp-success' : 'bg-pp-danger/10 text-pp-danger'}`}>
      {ok === null ? '–' : ok ? '✓' : '✗'} {label}
    </span>
  );

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-10 font-paypal text-pp-ink sm:px-8">
      <Link href="/" className="text-sm font-semibold text-pp-blue hover:underline">
        ← Vouch
      </Link>
      <h1 className="mt-3 text-[26px] font-semibold text-pp-navy">{m.summary}</h1>
      <p className="mt-1 text-sm text-pp-muted">
        {m.id} · {m.status.toLowerCase()} · approved {fmt(m.approved_at)} by {m.buyer_email ?? '-'}
      </p>
      <div className="mt-4 flex flex-wrap gap-2">
        {badge(v.hashMatches, 'Rules match fingerprint')}
        {badge(v.signatureMatches, 'Vouch signature')}
        {badge(v.paypalMatches, 'PayPal custom_id matches')}
      </div>

      <section className="mt-6 rounded-xl border border-pp-border bg-pp-surface p-5 text-sm">
        <p className="italic text-pp-muted">“{m.raw_text}”</p>
        <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-6 gap-y-2">
          <dt className="text-pp-muted">Category</dt>
          <dd className="font-medium">{m.rules.category}</dd>
          <dt className="text-pp-muted">Limit</dt>
          <dd className="font-medium">${m.rules.maxAmount.toFixed(2)} {m.rules.currency}</dd>
          <dt className="text-pp-muted">Expires</dt>
          <dd>{fmt(m.rules.expiresAt)}</dd>
          {m.rules.deliverBy && (
            <>
              <dt className="text-pp-muted">Arrive by</dt>
              <dd>{fmt(m.rules.deliverBy)}</dd>
            </>
          )}
          {m.rules.notes && (
            <>
              <dt className="text-pp-muted">Preferences</dt>
              <dd>{m.rules.notes}</dd>
            </>
          )}
          <dt className="text-pp-muted">PayPal order</dt>
          <dd className="font-mono text-xs">{m.order_id ?? '-'}</dd>
          <dt className="text-pp-muted">Fingerprint</dt>
          <dd className="break-all font-mono text-xs">{m.hash}</dd>
        </dl>
      </section>

      {purchases.map((p) => (
        <section key={p.id} className="mt-6 rounded-xl border border-pp-border bg-pp-surface p-5 text-sm">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-semibold text-pp-navy">
              Bought: {p.item_name} · ${Number(p.amount).toFixed(2)}
            </h2>
            <span className={`rounded-full px-3 py-1 text-xs font-semibold ${p.in_mandate ? 'bg-pp-success/10 text-pp-success' : 'bg-pp-danger/10 text-pp-danger'}`}>
              {p.in_mandate ? 'Within mandate' : 'Outside mandate'}
            </span>
          </div>
          <p className="mt-2 text-pp-muted">
            PayPal capture <code className="font-mono text-xs">{p.capture_id}</code> · {p.carrier ?? 'no carrier'}{' '}
            <code className="font-mono text-xs">{p.tracking_number ?? ''}</code> · {fmt(p.created_at)}
          </p>
        </section>
      ))}

      {m.status === 'AUTHORIZED' && <RunShopper mandateId={m.id} />}

      {trail.length > 0 && (
        <section className="mt-6 rounded-xl border border-pp-border bg-pp-surface p-5">
          <h2 className="font-semibold text-pp-navy">Shopping agent decision trail</h2>
          <ol className="mt-3 space-y-3 text-sm">
            {trail.map((s) => (
              <li key={s.id}>
                {s.tool ? (
                  <details>
                    <summary className="cursor-pointer">
                      <code className="rounded bg-pp-highlight px-1.5 py-0.5 text-xs text-pp-blue">{s.tool}</code>{' '}
                      <span className="text-pp-muted">{JSON.stringify(s.input)}</span>
                    </summary>
                    <pre className="mt-2 max-h-64 overflow-auto rounded bg-pp-canvas p-3 text-xs">{JSON.stringify(s.output, null, 2)}</pre>
                  </details>
                ) : (
                  <p className="whitespace-pre-line text-pp-muted">{s.reasoning}</p>
                )}
              </li>
            ))}
          </ol>
        </section>
      )}
    </main>
  );
}
