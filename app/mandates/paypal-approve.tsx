'use client';

// The PayPal button that turns a DRAFT mandate into an authorization hold: createOrder ->
// buyer approves in PayPal -> /authorize. Used by /mandates/new and by /mandates/[id]/approve,
// the page an external (MCP) agent sends its user to.

import Script from 'next/script';
import { useEffect, useRef, useState } from 'react';

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

export async function postJson<T>(url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body ?? {}) });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status})`);
  return data as T;
}

export function PayPalApprove<M>({
  clientId,
  mandateId,
  onAuthorized,
  onError,
}: {
  clientId: string;
  mandateId: string;
  onAuthorized: (mandate: M) => void;
  onError: (message: string) => void;
}) {
  const [sdkReady, setSdkReady] = useState(typeof window !== 'undefined' && !!window.paypal);
  const buttonRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!sdkReady || !buttonRef.current || !window.paypal) return;
    const el = buttonRef.current;
    el.innerHTML = '';
    const buttons = window.paypal.Buttons({
      style: { layout: 'vertical', label: 'paypal', shape: 'rect' },
      createOrder: async () => (await postJson<{ id: string }>(`/api/mandates/${mandateId}/order`)).id,
      onApprove: async ({ orderID }) => {
        try {
          const res = await postJson<{ mandate: M }>(`/api/mandates/${mandateId}/authorize`, { orderID });
          onAuthorized(res.mandate);
        } catch (err) {
          onError((err as Error).message);
        }
      },
      onError: (err) => onError(`PayPal error: ${String(err)}`),
    });
    buttons.render(el).catch(() => {});
    return () => {
      buttons.close?.().catch(() => {});
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sdkReady, mandateId]);

  return (
    <>
      <Script
        src={`https://www.paypal.com/sdk/js?client-id=${encodeURIComponent(clientId)}&intent=authorize&currency=USD&components=buttons`}
        onReady={() => setSdkReady(true)}
      />
      <div ref={buttonRef} className="max-w-sm" />
      {!sdkReady && <p className="text-sm text-pp-muted">Loading PayPal…</p>}
    </>
  );
}
