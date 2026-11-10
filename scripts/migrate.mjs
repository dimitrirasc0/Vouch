// Applies db/schema.sql. Usage: npm run db:migrate
import { readFile } from 'node:fs/promises';
import pg from 'pg';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL missing in .env');
  process.exit(1);
}
const client = new pg.Client({ connectionString: url, ssl: url.includes('localhost') ? undefined : { rejectUnauthorized: false } });
await client.connect();
await client.query(await readFile(new URL('../db/schema.sql', import.meta.url), 'utf8'));
const { rows } = await client.query(
  "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY 1",
);
console.log('Schema applied. Tables:', rows.map((r) => r.table_name).join(', '));
await client.end();
