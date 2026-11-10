'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

type Rec = {
  verdict: 'IN_MANDATE' | 'OUT_OF_MANDATE' | 'UNKNOWN';
  action: 'FIGHT' | 'OFFER' | 'ACCEPT';
  confidence: string | null;
  explanation: string | null;
  draft: string | null;
  offer_amount: string | null;
  evidence: {
    points?: string[];
    verdict_reason?: string;
    mandate_id?: string;
    recheck?: { checks: { rule: string; pass: boolean; detail: string }[] };
    verification?: { hashMatches: boolean; signatureMatches: boolean; paypalMatches: boolean | null };
  } | null;
  submitted_at: string | null;
  result: { ok: boolean; status: number; body: unknown } | null;
};
type Step = { id: string; step: number; tool: string | null; input: unknown; output: unknown; reasoning: string | null };

const VERDICT = {
  IN_MANDATE: { label: 'In mandate', cls: 'bg-pp-success/10 text-pp-success' },
  OUT_OF_MANDATE: { label: 'Out of mandate', cls: 'bg-pp-danger/10 text-pp-danger' },
  UNKNOWN: { label: 'No mandate', cls: 'bg-pp-warning/10 text-pp-warning' },
};
const ACTION = { FIGHT: 'Fight with evidence', OFFER: 'Offer partial refund', ACCEPT: 'Accept and refund' };

async function post(url: string, body?: unknown) {
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body ?? {}) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? `PayPal returned ${res.status}: ${JSON.stringify(data.body ?? data).slice(0, 400)}`);
  return data;
}

export function Review({ disputeId, status, outcome, rec, trail }: { disputeId: string; status: string; outcome: string | null; rec: Rec | null; trail: Step[] }) {
  const router = useRouter();
  const [draft, setDraft] = useState(rec?.draft ?? '');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = (label: string, fn: () => Promise<unknown>) => async () => {
    setBusy(label);
    setError(null);
    try {
      await fn();
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  };

  if (!rec) {
    return (
      <section className="mt-6 rounded-xl border border-pp-border bg-pp-surface p-5">
        <p className="text-sm text-pp-muted">The agent hasn’t investigated this dispute yet.</p>
        <button onClick={run('agent', () => post(`/api/agent/dispute/${disputeId}`))} disabled={!!busy} className="mt-3 rounded-full bg-pp-blue px-5 py-2 font-semibold text-white disabled:opacity-50">
          {busy ? 'Investigating…' : 'Run dispute agent'}
        </button>
        {error && <p className="mt-3 text-sm text-pp-danger">{error}</p>}
      </section>
    );
  }

  const v = VERDICT[rec.verdict];
  const confidence = rec.confidence ? Math.round(Number(rec.confidence) * 100) : null;
  const resolved = status === 'RESOLVED';

  return (
    <>
      <section className="mt-6 rounded-xl border border-pp-border bg-pp-surface p-5">
        <div className="flex flex-wrap items-center gap-3">
          <span className={`rounded-full px-3 py-1 text-xs font-semibold ${v.cls}`}>{v.label}</span>
          <span className="text-lg font-semibold text-pp-navy">Recommendation: {ACTION[rec.action]}</span>
          {confidence !== null && <span className="text-sm text-pp-muted">{confidence}% confidence</span>}
        </div>
        <p className="mt-3 leading-relaxed">{rec.explanation}</p>
        {rec.evidence?.verdict_reason && <p className="mt-2 text-sm text-pp-muted">Rule engine: {rec.evidence.verdict_reason}</p>}

        {rec.evidence?.recheck && (
          <div className="mt-4 grid gap-1.5 text-sm sm:grid-cols-2">
            {rec.evidence.recheck.checks.map((c) => (
              <div key={c.rule} className="flex gap-2">
                <span className={c.pass ? 'text-pp-success' : 'text-pp-danger'}>{c.pass ? '✓' : '✗'}</span>
                <span className="font-medium">{c.rule}</span>
                <span className="truncate text-pp-muted">{c.detail}</span>
              </div>
            ))}
            {rec.evidence.verification && (
              <div className="flex gap-2">
                <span className={rec.evidence.verification.paypalMatches ? 'text-pp-success' : 'text-pp-danger'}>
                  {rec.evidence.verification.paypalMatches ? '✓' : '✗'}
                </span>
                <span className="font-medium">PayPal fingerprint</span>
                <span className="text-pp-muted">order custom_id matches mandate</span>
              </div>
            )}
          </div>
        )}
        {rec.evidence?.mandate_id && (
          <a href={`/api/disputes/${disputeId}/evidence`} target="_blank" className="mt-4 inline-block text-sm font-semibold text-pp-blue hover:underline">
            View evidence PDF →
          </a>
        )}
      </section>

      <section className="mt-6 rounded-xl border border-pp-border bg-pp-surface p-5">
        <h2 className="font-semibold text-pp-navy">Response to PayPal</h2>
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          disabled={!!rec.submitted_at}
          rows={12}
          className="mt-3 w-full rounded-lg border border-pp-border bg-pp-canvas p-3 text-sm leading-relaxed outline-none focus:border-pp-blue disabled:opacity-70"
        />
        <p className="mt-1 text-right text-xs text-pp-muted">{draft.length}/2000</p>

        {!rec.submitted_at ? (
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <button
              onClick={run('submit', () => post(`/api/disputes/${disputeId}/submit`, { note: draft }))}
              disabled={!!busy || draft.length > 2000}
              className="rounded-full bg-pp-blue px-5 py-2 font-semibold text-white hover:bg-pp-blue-dark disabled:opacity-50"
            >
              {busy === 'submit' ? 'Submitting to PayPal…' : `Approve & submit: ${ACTION[rec.action]}`}
            </button>
            <button onClick={run('agent', () => post(`/api/agent/dispute/${disputeId}`))} disabled={!!busy} className="text-sm font-semibold text-pp-blue disabled:opacity-50">
              {busy === 'agent' ? 'Re-investigating…' : 'Re-run agent'}
            </button>
          </div>
        ) : (
          <div className="mt-3 text-sm">
            <p className={rec.result?.ok ? 'text-pp-success' : 'text-pp-danger'}>
              {rec.result?.ok ? '✓ Submitted to PayPal' : '✗ PayPal rejected the submission'} · {new Date(rec.submitted_at).toLocaleString()}
            </p>
            {!resolved && (
              <button
                onClick={run('adjudicate', () => post(`/api/disputes/${disputeId}/adjudicate`, { outcome: 'SELLER_FAVOR' }))}
                disabled={!!busy}
                className="mt-3 rounded-full border border-pp-border px-4 py-2 font-semibold text-pp-navy disabled:opacity-50"
              >
                {busy === 'adjudicate' ? 'Asking PayPal…' : 'Simulate PayPal decision (sandbox)'}
              </button>
            )}
            {resolved && <p className="mt-2 font-semibold text-pp-navy">Resolved: {outcome?.replaceAll('_', ' ').toLowerCase()}</p>}
          </div>
        )}
        {error && <p className="mt-3 break-words text-sm text-pp-danger">{error}</p>}
        {rec.result && !rec.result.ok && (
          <pre className="mt-3 max-h-48 overflow-auto rounded bg-pp-canvas p-3 text-xs">{JSON.stringify(rec.result.body, null, 2)}</pre>
        )}
      </section>

      <section className="mt-6 rounded-xl border border-pp-border bg-pp-surface p-5">
        <h2 className="font-semibold text-pp-navy">How the agent investigated</h2>
        <ol className="mt-3 space-y-3">
          {trail.map((s) => (
            <li key={s.id} className="text-sm">
              {s.tool ? (
                <details>
                  <summary className="cursor-pointer">
                    <code className="rounded bg-pp-highlight px-1.5 py-0.5 text-xs text-pp-blue">{s.tool}</code>
                  </summary>
                  <pre className="mt-2 max-h-64 overflow-auto rounded bg-pp-canvas p-3 text-xs">{JSON.stringify(s.output ?? s.input, null, 2)}</pre>
                </details>
              ) : (
                <p className="whitespace-pre-line italic text-pp-muted">{s.reasoning}</p>
              )}
            </li>
          ))}
        </ol>
      </section>
    </>
  );
}
