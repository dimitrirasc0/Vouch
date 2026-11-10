// Refreshes every dispute from PayPal (the "Sync disputes" button; also a fallback for late webhooks).
import { syncDisputes } from '@/lib/disputes';

export async function POST() {
  try {
    const rows = await syncDisputes();
    return Response.json({ count: rows.length, disputes: rows.map(({ raw: _raw, ...r }) => r) });
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 502 });
  }
}
