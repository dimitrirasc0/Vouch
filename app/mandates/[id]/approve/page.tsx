// The approval link an external agent (via the MCP server) gives its user. Only the buyer, signed in
// to PayPal, can approve the hold; the agent has no way to do it for them.
import { notFound } from 'next/navigation';
import { connection } from 'next/server';
import { getMandate } from '@/lib/mandates';
import { MandateCard } from '../../mandate-card';
import { SiteNav } from '../../../site-nav';

export const metadata = { title: 'Approve mandate' };

export default async function Page({ params }: PageProps<'/mandates/[id]/approve'>) {
  await connection();
  const { id } = await params;
  const m = await getMandate(id);
  if (!m) notFound();
  const client = m.source_client;

  return (
    <>
      <SiteNav />
      <main className="mx-auto w-full max-w-2xl px-4 py-12 font-paypal text-pp-ink sm:px-8">
        <p className="text-sm font-semibold uppercase tracking-wider text-pp-blue">Vouch</p>
        <h1 className="mt-1 text-[28px] font-semibold text-pp-navy">{client ? `${client} wants to shop for you` : 'Your AI agent wants to shop for you'}</h1>
        <p className="mt-2 text-pp-muted">
          Your agent asked Vouch for permission to make one purchase. Check the rules below and approve them in PayPal. The agent can
          only spend within them, and your approval becomes evidence if the purchase is ever disputed.
        </p>
        <p className="mt-3 rounded-lg bg-pp-highlight px-3 py-2 text-sm text-pp-blue">
          Your request: “{m.raw_text}”
        </p>
        <MandateCard
          initial={JSON.parse(JSON.stringify(m))}
          clientId={process.env.NEXT_PUBLIC_PAYPAL_CLIENT_ID ?? ''}
          doneHint="Done. Go back to your agent and tell it the mandate is approved."
        />
      </main>
    </>
  );
}
