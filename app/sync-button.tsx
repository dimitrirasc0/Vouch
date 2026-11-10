'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

export function SyncButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <button
      onClick={async () => {
        setBusy(true);
        await fetch('/api/disputes/sync', { method: 'POST' }).catch(() => {});
        setBusy(false);
        router.refresh();
      }}
      disabled={busy}
      className="rounded-full border border-pp-border px-4 py-2 text-sm font-semibold text-pp-navy disabled:opacity-50"
    >
      {busy ? 'Syncing…' : 'Sync from PayPal'}
    </button>
  );
}
