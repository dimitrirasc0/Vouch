'use client';

import Link from 'next/link';
import Script from 'next/script';
import { useEffect, useRef, useState } from 'react';

type Rules = { category: string; maxAmount: number; currency: string; expiresAt: string; deliverBy?: string; notes?: string };
type Mandate = { id: string; summary: string; rules: Rules; hash: string; status: string; authorization_id: string | null; buyer_email: string | null };

type PayPalButtons = { render: (el: HTMLElement) => Promise<void>; close?: () => Promise<void> };
declare global {
  interface Window {
    paypal?: {
      Buttons: (opts: {
        style?: Record<string, string>;
        createOrder: () => Promise<string>;
        onApprove: (data: { orderID: string }) => Promise<void>;
        onError?: (err: unknown) => void;
      }) => PayPalButtons;
    };
  }
}

const EXAMPLE = 'Buy me a USB-C charger, at least 45W if possible, no more than $30. It needs to arrive within 5 days.';

const fmtDate = (iso: string) =>
  new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'UTC', timeZoneName: 'short' });

async function postJson<T>(url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body ?? {}) });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status})`);
  return data as T;
}

export function NewMandate({ clientId }: { clientId: string }) {
  const [text, setText] = useState(EXAMPLE);
  const [mandate, setMandate] = useState<Mandate | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sdkReady, setSdkReady] = useState(false);
  const buttonRef = useRef<HTMLDivElement>(null);

  async function parse() {
    setBusy(true);
    setError(null);
    setMandate(null);
    try {
      const { mandate } = await postJson<{ mandate: Mandate }>('/api/mandates/parse', { text });
      setMandate(mandate);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  // Render the PayPal button once there is a draft mandate and the SDK has loaded.
  useEffect(() => {
    if (!sdkReady || !mandate || mandate.status !== 'DRAFT' || !buttonRef.current || !window.paypal) return;
    const el = buttonRef.current;
    el.innerHTML = '';
    const buttons = window.paypal.Buttons({
      style: { layout: 'vertical', label: 'paypal', shape: 'rect' },
      createOrder: async () => (await postJson<{ id: string }>(`/api/mandates/${mandate.id}/order`)).id,
      onApprove: async ({ orderID }) => {
        try {
          const res = await postJson<{ mandate: Mandate }>(`/api/mandates/${mandate.id}/authorize`, { orderID });
          setMandate(res.mandate);
        } catch (err) {
          setError((err as Error).message);
        }
      },
      onError: (err) => setError(`PayPal error: ${String(err)}`),
    });
    buttons.render(el).catch(() => {});
    return () => {
      buttons.close?.().catch(() => {});
    };
  }, [sdkReady, mandate]);

  return (
    <>
      <Script
        src={`https://www.paypal.com/sdk/js?client-id=${encodeURIComponent(clientId)}&intent=authorize&currency=USD&components=buttons`}
        onReady={() => setSdkReady(true)}
      />

      <section className="mt-8 rounded-xl border border-pp-border bg-pp-surface p-5">
        <label htmlFor="mandate-text" className="text-sm font-semibold">
          Instructions for your agent
        </label>
        <textarea
          id="mandate-text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={3}
          className="mt-2 w-full rounded-lg border border-pp-border bg-pp-canvas p-3 text-base outline-none focus:border-pp-blue"
        />
        <button
          onClick={parse}
          disabled={busy}
          className="mt-3 rounded-full bg-pp-blue px-5 py-2 font-semibold text-white hover:bg-pp-blue-dark disabled:opacity-50"
        >
          {busy ? 'Reading your instructions…' : 'Create mandate'}
        </button>
        {error && <p className="mt-3 text-sm text-pp-danger">{error}</p>}
      </section>

      {mandate && (
        <section className="mt-6 rounded-xl border border-pp-border bg-pp-surface p-5">
          <div className="flex items-center justify-between gap-3">
            <h2 className="font-semibold text-pp-navy">Mandate rules</h2>
            <span
              className={`rounded-full px-3 py-1 text-xs font-semibold ${
                mandate.status === 'AUTHORIZED' ? 'bg-pp-success/10 text-pp-success' : 'bg-pp-highlight text-pp-blue'
              }`}
            >
              {mandate.status === 'AUTHORIZED' ? 'Approved in PayPal' : 'Awaiting your approval'}
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

          {mandate.status === 'DRAFT' ? (
            <div className="mt-5 border-t border-pp-border pt-5">
              <p className="mb-3 text-sm text-pp-muted">
                Approving places a ${mandate.rules.maxAmount.toFixed(2)} hold, not a charge. The agent can only capture what
                it spends within these rules.
              </p>
              <div ref={buttonRef} className="max-w-sm" />
              {!sdkReady && <p className="text-sm text-pp-muted">Loading PayPal…</p>}
            </div>
          ) : (
            <div className="mt-5 border-t border-pp-border pt-5 text-sm">
              <p>
                Authorized by <span className="font-medium">{mandate.buyer_email}</span>. PayPal authorization{' '}
                <code className="font-mono text-xs">{mandate.authorization_id}</code>.
              </p>
              <Link href={`/mandates/${mandate.id}`} className="mt-3 inline-block font-semibold text-pp-blue hover:underline">
                Open mandate →
              </Link>
            </div>
          )}
        </section>
      )}
    </>
  );
}
