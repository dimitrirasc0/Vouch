'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

export function RunShopper({ mandateId }: { mandateId: string }) {
  const router = useRouter();
  const [overstep, setOverstep] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/agent/shop/${mandateId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ overstep }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `Failed (${res.status})`);
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="mt-6 rounded-xl border border-pp-border bg-pp-surface p-5">
      <h2 className="font-semibold text-pp-navy">Shopping agent</h2>
      <p className="mt-1 text-sm text-pp-muted">The agent searches the catalog and can only buy an item that passes this mandate.</p>
      <label className="mt-4 flex items-start gap-2 rounded-lg border border-dashed border-pp-warning/60 bg-pp-warning/5 p-3 text-sm">
        <input type="checkbox" checked={overstep} onChange={(e) => setOverstep(e.target.checked)} className="mt-0.5" />
        <span>
          <strong className="text-pp-warning">Demo: misbehaving agent (overstep)</strong>
          <br />
          Runs a scripted, non-AI agent that skips the mandate check (like a buggy third-party agent), so you can see how Vouch handles a purchase outside the mandate.
        </span>
      </label>
      <button onClick={run} disabled={busy} className="mt-4 rounded-full bg-pp-blue px-5 py-2 font-semibold text-white hover:bg-pp-blue-dark disabled:opacity-50">
        {busy ? 'Agent is shopping…' : overstep ? 'Run misbehaving agent (demo)' : 'Run shopping agent'}
      </button>
      {error && <p className="mt-3 text-sm text-pp-danger">{error}</p>}
    </section>
  );
}
