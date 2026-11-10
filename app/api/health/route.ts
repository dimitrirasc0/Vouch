// Render health check: the app is up and can reach Postgres.
import { query } from '@/lib/db';

export async function GET() {
  try {
    await query('SELECT 1');
    return Response.json({ ok: true });
  } catch (err) {
    return Response.json({ ok: false, error: (err as Error).message }, { status: 503 });
  }
}
