'use client';

import { useState } from 'react';
import { MandateCard, type Mandate } from '../mandate-card';
import { postJson } from '../paypal-approve';

const EXAMPLE = 'Buy me a USB-C charger, at least 45W if possible, no more than $30. It needs to arrive within 5 days.';

export function NewMandate({ clientId }: { clientId: string }) {
  const [text, setText] = useState(EXAMPLE);
  const [mandate, setMandate] = useState<Mandate | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  return (
    <>
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

      {mandate && <MandateCard key={mandate.id} initial={mandate} clientId={clientId} />}
    </>
  );
}
