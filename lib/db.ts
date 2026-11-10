// Postgres access. One hosted database (Neon/Render) serves local dev and production.
import 'server-only';
import { Pool, type QueryResultRow } from 'pg';

declare global {
  // Survive Next.js dev hot reloads without opening a new pool each time.
  var __vouchPool: Pool | undefined;
}

function pool(): Pool {
  if (!globalThis.__vouchPool) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error('DATABASE_URL must be set (see .env)');
    globalThis.__vouchPool = new Pool({
      connectionString: url,
      ssl: url.includes('localhost') ? undefined : { rejectUnauthorized: false },
      max: 5,
    });
  }
  return globalThis.__vouchPool;
}

export async function query<T extends QueryResultRow = QueryResultRow>(text: string, params: unknown[] = []): Promise<T[]> {
  const res = await pool().query<T>(text, params);
  return res.rows;
}

export async function one<T extends QueryResultRow = QueryResultRow>(text: string, params: unknown[] = []): Promise<T | undefined> {
  return (await query<T>(text, params))[0];
}
