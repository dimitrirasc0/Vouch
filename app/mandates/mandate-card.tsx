'use client';

// A mandate's rules plus its PayPal approval state. Shown after creating a mandate on /mandates/new
// and on /mandates/[id]/approve.

import Link from 'next/link';
import { useState } from 'react';
import { PayPalApprove } from './paypal-approve';

type Rules = { category: string; maxAmount: number; currency: string; expiresAt: string; deliverBy?: string; notes?: string };
export type Mandate = { id: string; summary: string; rules: Rules; hash: string; status: string; authorization_id: string | null; buyer_email: string | null };

const fmtDate = (iso: string) =>
  new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'UTC', timeZoneName: 'short' });

export function MandateCard({ initial, clientId, doneHint }: { initial: Mandate; clientId: string; doneHint?: string }) {
  const [mandate, setMandate] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const approved = mandate.status !== 'DRAFT';

  return (
    <section className="mt-6 rounded-xl border border-pp-border bg-pp-surface p-5">
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-semibold text-pp-navy">Mandate rules</h2>
        <span className={`rounded-full px-3 py-1 text-xs font-semibold ${approved ? 'bg-pp-success/10 text-pp-success' : 'bg-pp-highlight text-pp-blue'}`}>
          {approved ? 'Approved in PayPal' : 'Awaiting your approval'}
        </span>
      </div>
      <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
        <dt className="text-pp-muted">Category</dt>
        <dd className="font-medium">{mandate.rules.category}</dd>
        <dt className="text-pp-muted">Spending limit</dt>
        <dd className="font-medium">
          ${mandate.rules.maxAmount.toFixed(2)} {mandate.rules.currency}
        </dd>
        <dt className="text-pp-muted">Expires</dt>
        <dd className="font-medium">{fmtDate(mandate.rules.expiresAt)}</dd>
        {mandate.rules.deliverBy && (
          <>
            <dt className="text-pp-muted">Must arrive by</dt>
            <dd className="font-medium">{fmtDate(mandate.rules.deliverBy)}</dd>
          </>
        )}
        {mandate.rules.notes && (
          <>
            <dt className="text-pp-muted">Preferences</dt>
            <dd>{mandate.rules.notes}</dd>
          </>
        )}
        <dt className="text-pp-muted">Fingerprint</dt>
        <dd className="break-all font-mono text-xs">{mandate.hash}</dd>
      </dl>

      {!approved ? (
        <div className="mt-5 border-t border-pp-border pt-5">
          <p className="mb-3 text-sm text-pp-muted">
            Approving places a ${mandate.rules.maxAmount.toFixed(2)} hold, not a charge. The agent can only capture what it spends
            within these rules.
          </p>
          <PayPalApprove<Mandate> clientId={clientId} mandateId={mandate.id} onAuthorized={setMandate} onError={setError} />
        </div>
      ) : (
        <div className="mt-5 border-t border-pp-border pt-5 text-sm">
          <p>
            Authorized by <span className="font-medium">{mandate.buyer_email}</span>. PayPal authorization{' '}
            <code className="font-mono text-xs">{mandate.authorization_id}</code>.
          </p>
          {doneHint && <p className="mt-2 font-medium text-pp-success">{doneHint}</p>}
          <Link href={`/mandates/${mandate.id}`} className="mt-3 inline-block font-semibold text-pp-blue hover:underline">
            Open mandate →
          </Link>
        </div>
      )}
      {error && <p className="mt-3 text-sm text-pp-danger">{error}</p>}
    </section>
  );
}
