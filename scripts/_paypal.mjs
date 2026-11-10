// Shared helpers for the CLI scripts. Plain fetch, no dependencies.
// Run scripts with: node --env-file=.env scripts/<name>.mjs

export const BASE_URL = process.env.PAYPAL_BASE_URL || 'https://api-m.sandbox.paypal.com';

export function env(name, { optional = false } = {}) {
  const v = process.env[name];
  if (!v && !optional) {
    console.error(`Missing ${name} in .env (see env.example)`);
    process.exit(1);
  }
  return v;
}

let cached;
export async function token() {
  if (cached && Date.now() < cached.expiresAt) return cached;
  const id = env('PAYPAL_CLIENT_ID');
  const secret = env('PAYPAL_CLIENT_SECRET');
  const res = await fetch(`${BASE_URL}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });
  const body = await res.json();
  if (!res.ok) throw new Error(`OAuth failed ${res.status}: ${JSON.stringify(body)}`);
  cached = { ...body, expiresAt: Date.now() + (body.expires_in - 60) * 1000 };
  return cached;
}

// Calls the REST API. Returns { status, ok, body, headers }; never throws on HTTP errors so the
// scripts can print exactly what PayPal said.
export async function api(method, path, { json, form, headers = {} } = {}) {
  const { access_token } = await token();
  const init = { method, headers: { Authorization: `Bearer ${access_token}`, ...headers } };
  if (json !== undefined) {
    init.headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(json);
  } else if (form) {
    init.body = form; // FormData: fetch sets the multipart boundary itself
  }
  const res = await fetch(`${BASE_URL}${path}`, init);
  const text = await res.text();
  let body;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  return { status: res.status, ok: res.ok, body, headers: res.headers };
}

export function print(label, r) {
  console.log(`\n== ${label}: HTTP ${r.status}`);
  console.log(typeof r.body === 'string' ? r.body : JSON.stringify(r.body, null, 2));
  const debugId = r.headers?.get?.('paypal-debug-id');
  if (debugId) console.log(`(paypal-debug-id: ${debugId})`);
}
