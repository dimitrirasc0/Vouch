import type { Metadata } from 'next';
import { NewMandate } from './new-mandate';
import { SiteNav } from "../../site-nav";

export const metadata: Metadata = { title: 'New mandate' };

export default function Page() {
  return (
    <>
      <SiteNav />
      <main className="mx-auto w-full max-w-2xl px-4 py-12 font-paypal text-pp-ink sm:px-8">
      <p className="text-sm font-semibold uppercase tracking-wider text-pp-blue">Vouch</p>
      <h1 className="mt-1 text-[28px] font-semibold text-pp-navy">Give your shopping agent a mandate</h1>
      <p className="mt-2 text-pp-muted">
        Say what the agent may buy. Vouch turns it into strict rules, and you approve them in PayPal. The agent can never
        spend outside them, and the approved mandate becomes evidence if the purchase is ever disputed.
      </p>
      <NewMandate clientId={process.env.NEXT_PUBLIC_PAYPAL_CLIENT_ID ?? ''} />
    </main>
    </>
  );
}
