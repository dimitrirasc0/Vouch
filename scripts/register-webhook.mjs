// Registers (or lists) the sandbox webhook for dispute events.
// Usage: node --env-file=.env scripts/register-webhook.mjs https://<public-host>/api/webhooks/paypal
// Put the printed id in .env as PAYPAL_WEBHOOK_ID (needed for signature verification).

import { api, print } from './_paypal.mjs';

const url = process.argv[2];
if (!url) {
  print('Registered webhooks', await api('GET', '/v1/notifications/webhooks'));
  console.log('\nUsage: register-webhook.mjs <https URL ending in /api/webhooks/paypal>');
  process.exit(0);
}

const r = await api('POST', '/v1/notifications/webhooks', {
  json: {
    url,
    event_types: ['CUSTOMER.DISPUTE.CREATED', 'CUSTOMER.DISPUTE.UPDATED', 'CUSTOMER.DISPUTE.RESOLVED'].map((name) => ({ name })),
  },
});
print('Register webhook', r);
if (r.ok) console.log(`\nAdd to .env:  PAYPAL_WEBHOOK_ID=${r.body.id}`);
