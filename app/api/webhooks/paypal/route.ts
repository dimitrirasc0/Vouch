// PayPal webhook receiver: verify signature, record the event (deduped by id), refresh the dispute.
// Sandbox webhooks arrive late and out of order, so we always re-fetch the dispute from PayPal
// instead of trusting the payload snapshot.

import { after } from 'next/server';
import { query } from '@/lib/db';
import { refreshDispute } from '@/lib/disputes';
import { paypalPost } from '@/lib/paypal';

type WebhookEvent = { id?: string; event_type?: string; resource?: { dispute_id?: string } };

async function verify(req: Request, event: WebhookEvent): Promise<string> {
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
    }, { idempotent: true });
    return res.verification_status;
  } catch (err) {
    return `ERROR ${(err as Error).message.slice(0, 120)}`;
  }
}

export async function POST(req: Request) {
  let event: WebhookEvent;
  try {
    event = JSON.parse(await req.text());
  } catch {
    return new Response('bad json', { status: 400 });
  }

  const verification = await verify(req, event);
  const disputeId = event.resource?.dispute_id;
  console.log(`[webhook] ${event.event_type} ${disputeId ?? ''} verification=${verification}`);

  if (verification !== 'SUCCESS') {
    // Don't act on unverified events. 200 anyway so test pings and replays don't retry forever.
    return Response.json({ ok: true, ignored: verification });
  }

  const inserted = await query(
    `INSERT INTO webhook_events (id, event_type, verification, payload) VALUES ($1,$2,$3,$4)
     ON CONFLICT (id) DO NOTHING RETURNING id`,
    [event.id ?? `noid-${Date.now()}`, event.event_type ?? 'UNKNOWN', verification, event],
  );

  if (inserted.length && disputeId && event.event_type?.startsWith('CUSTOMER.DISPUTE.')) {
    // Respond to PayPal immediately; do the slower work after the response is sent.
    after(async () => {
      try {
        const row = await refreshDispute(disputeId);
        console.log(`[webhook] dispute ${row.id} -> ${row.status}/${row.stage}`);
        // Next step: on first sight of a dispute, start the dispute agent here.
      } catch (err) {
        console.error(`[webhook] refresh ${disputeId} failed:`, (err as Error).message);
      }
    });
  }

  return Response.json({ ok: true });
}
