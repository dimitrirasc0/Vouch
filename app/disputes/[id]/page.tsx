import Link from 'next/link';
import { notFound } from 'next/navigation';
import { connection } from 'next/server';
import { query } from '@/lib/db';
import { getDisputeRow, refreshDispute } from '@/lib/disputes';
import { latestRecommendation } from '@/lib/submit';
import { Review } from './review';

export async function generateMetadata({ params }: PageProps<'/disputes/[id]'>) {
  return { title: `Dispute ${(await params).id}` };
}

const REASONS: Record<string, string> = {
  MERCHANDISE_OR_SERVICE_NOT_RECEIVED: 'Item not received',
  MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED: 'Not as described',
  UNAUTHORISED: 'Unauthorized',
  INCORRECT_AMOUNT: 'Incorrect amount',
};

export default async function Page({ params }: PageProps<'/disputes/[id]'>) {
  await connection();
  const { id } = await params;
  const dispute = (await getDisputeRow(id)) ?? (await refreshDispute(id).catch(() => undefined));
  if (!dispute) notFound();
  const rec = await latestRecommendation(id);
  const trail = await query<{ id: string; step: number; tool: string | null; input: unknown; output: unknown; reasoning: string | null }>(
    `SELECT id, step, tool, input, output, reasoning FROM agent_decisions WHERE dispute_id = $1 ORDER BY id`,
    [id],
  );
  // Only the latest run's trail: steps restart at 1 each run.
  const lastStart = trail.map((t) => t.step).lastIndexOf(1);
  const latestTrail = lastStart >= 0 ? trail.slice(lastStart) : trail;
  const buyerMessage = (dispute.raw.messages as { posted_by: string; content: string }[] | undefined)?.find((m) => m.posted_by === 'BUYER')?.content
    ?? ((dispute.raw.disputed_transactions as { items?: { notes?: string }[] }[] | undefined)?.[0]?.items?.[0]?.notes);

  return (
    <main className="mx-auto w-full max-w-4xl px-4 py-10 font-paypal text-pp-ink sm:px-8">
      <Link href="/" className="text-sm font-semibold text-pp-blue hover:underline">
        ← All disputes
      </Link>
      <div className="mt-3 flex flex-wrap items-baseline justify-between gap-3">
        <h1 className="text-[26px] font-semibold text-pp-navy">
          {REASONS[dispute.reason ?? ''] ?? dispute.reason} · ${Number(dispute.amount).toFixed(2)}
        </h1>
        <code className="text-sm text-pp-muted">{dispute.id}</code>
      </div>
      <p className="mt-1 text-sm text-pp-muted">
        {dispute.status?.replaceAll('_', ' ').toLowerCase()} · stage {dispute.stage?.toLowerCase()}
        {dispute.deadline && <> · respond by {new Date(dispute.deadline).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</>}
        {dispute.outcome && <> · outcome <strong>{dispute.outcome.replaceAll('_', ' ').toLowerCase()}</strong></>}
      </p>

      {buyerMessage && (
        <blockquote className="mt-5 rounded-xl border border-pp-border bg-pp-surface p-4 text-sm">
          <p className="text-xs font-semibold uppercase tracking-wider text-pp-muted">Buyer says</p>
          <p className="mt-1">“{buyerMessage.trim()}”</p>
        </blockquote>
      )}

      <Review
        disputeId={dispute.id}
        status={dispute.status ?? ''}
        outcome={dispute.outcome}
        rec={rec ? JSON.parse(JSON.stringify(rec)) : null}
        trail={JSON.parse(JSON.stringify(latestTrail))}
      />
    </main>
  );
}
