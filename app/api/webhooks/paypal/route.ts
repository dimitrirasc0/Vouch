// PayPal webhook receiver. Step 1: verify and log dispute events to data/webhook-events.jsonl.
// Later this hands CUSTOMER.DISPUTE.CREATED to the agent.

import { appendFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { paypalPost } from '@/lib/paypal';

const DATA_DIR = path.join(process.cwd(), 'data');

async function verify(req: Request, event: unknown): Promise<string> {
  const webhookId = process.env.PAYPAL_WEBHOOK_ID;
  if (!webhookId) return 'SKIPPED (no PAYPAL_WEBHOOK_ID)';
  const h = (n: string) => req.headers.get(n);
  try {
    const res = await paypalPost<{ verification_status: string }>('/v1/notifications/verify-webhook-signature', {
      auth_algo: h('paypal-auth-algo'),
      cert_url: h('paypal-cert-url'),
      transmission_id: h('paypal-transmission-id'),
      transmission_sig: h('paypal-transmission-sig'),
      transmission_time: h('paypal-transmission-time'),
      webhook_id: webhookId,
      webhook_event: event,
    });
    return res.verification_status;
  } catch (err) {
    return `ERROR ${(err as Error).message}`;
  }
}

export async function POST(req: Request) {
  const raw = await req.text();
  let event: { id?: string; event_type?: string; resource?: { dispute_id?: string } };
  try {
    event = JSON.parse(raw);
  } catch {
    return new Response('bad json', { status: 400 });
  }

  const verification = await verify(req, event);
  console.log(`[webhook] ${event.event_type} ${event.resource?.dispute_id ?? ''} verification=${verification}`);

  await mkdir(DATA_DIR, { recursive: true });
  await appendFile(
    path.join(DATA_DIR, 'webhook-events.jsonl'),
    JSON.stringify({ received_at: new Date().toISOString(), verification, event }) + '\n',
  );

  // Always 200 quickly so PayPal doesn't retry; processing happens asynchronously later.
  return Response.json({ ok: true });
}
