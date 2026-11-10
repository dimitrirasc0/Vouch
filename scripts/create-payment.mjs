// Creates a real sandbox payment the buyer can later dispute.
//
//   node --env-file=.env scripts/create-payment.mjs create [amount] ["description"]
//     -> prints an approval link. Open it, log in as the sandbox PERSONAL (buyer) account, approve.
//   node --env-file=.env scripts/create-payment.mjs capture <ORDER_ID>
//     -> captures the payment and prints the capture (seller transaction) id.

import { api, print } from './_paypal.mjs';

const [cmd, a1, a2] = process.argv.slice(2);

if (cmd === 'create') {
  const value = Number(a1 || 49.99).toFixed(2);
  const description = a2 || 'Handmade ceramic mug set';
  const r = await api('POST', '/v2/checkout/orders', {
    json: {
      intent: 'CAPTURE',
      purchase_units: [
        {
          description,
          amount: {
            currency_code: 'USD',
            value,
            breakdown: { item_total: { currency_code: 'USD', value } },
          },
          items: [{ name: description, quantity: '1', unit_amount: { currency_code: 'USD', value }, category: 'PHYSICAL_GOODS' }],
        },
      ],
      payment_source: {
        paypal: {
          experience_context: {
            shipping_preference: 'GET_FROM_FILE',
            user_action: 'PAY_NOW',
            return_url: 'https://example.com/return',
            cancel_url: 'https://example.com/cancel',
          },
        },
      },
    },
  });
  if (!r.ok) {
    print('Create order', r);
    process.exit(1);
  }
  const approve = r.body.links.find((l) => l.rel === 'payer-action' || l.rel === 'approve');
  console.log(`Order ${r.body.id} created for $${value}.`);
  console.log(`1) Open and approve as the sandbox buyer:\n   ${approve.href}`);
  console.log(`   (It redirects to example.com afterwards; that is expected.)`);
  console.log(`2) Then run: node --env-file=.env scripts/create-payment.mjs capture ${r.body.id}`);
} else if (cmd === 'capture' && a1) {
  const r = await api('POST', `/v2/checkout/orders/${a1}/capture`, { json: {} });
  if (!r.ok) {
    print('Capture', r);
    process.exit(1);
  }
  const cap = r.body.purchase_units[0].payments.captures[0];
  console.log(`Captured. status=${cap.status}`);
  console.log(`  capture / seller transaction id: ${cap.id}`);
  console.log(`  payer: ${r.body.payer?.email_address} (${r.body.payer?.payer_id})`);
  console.log(`Note: the BUYER sees a different transaction id on their sandbox Activity page.`);
  console.log(`create-dispute needs that buyer-side id (per PayPal docs); try the capture id too.`);
} else {
  console.log('Usage: create-payment.mjs create [amount] ["description"] | capture <ORDER_ID>');
}
