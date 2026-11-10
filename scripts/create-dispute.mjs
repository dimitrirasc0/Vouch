// Creates a sandbox dispute as the buyer via POST /v1/customer/disputes (sandbox-only endpoint).
// Per https://developer.paypal.com/disputes/set-up this needs:
//   - the REST app to hold the disputes/create scope (granted by PayPal, not self-serve), and
//   - a PayPal-Auth-Assertion JWT identifying the buyer (alg "none", iss = client id, email = buyer).
// If check-paypal.mjs shows no disputes/create scope, open disputes from the sandbox buyer UI instead.
//
// Usage: node --env-file=.env scripts/create-dispute.mjs <BUYER_TRANSACTION_ID> <amount> [reason]
//   reason: MERCHANDISE_OR_SERVICE_NOT_RECEIVED (default) | MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED | UNAUTHORISED

import { api, env, print } from './_paypal.mjs';

const [txn, amount, reason = 'MERCHANDISE_OR_SERVICE_NOT_RECEIVED'] = process.argv.slice(2);
if (!txn || !amount) {
  console.log('Usage: create-dispute.mjs <BUYER_TRANSACTION_ID> <amount> [reason]');
  process.exit(1);
}

const b64url = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const assertion = `${b64url({ alg: 'none', typ: 'JWT' })}.${b64url({
  iss: env('PAYPAL_CLIENT_ID'),
  email: env('PAYPAL_BUYER_EMAIL'),
})}.`;

const input = {
  disputed_transactions: [{ buyer_transaction_id: txn }],
  reason,
  dispute_amount: { currency_code: 'USD', value: Number(amount).toFixed(2) },
  extensions: { merchant_contacted: true, merchant_contacted_outcome: 'NO_RESPONSE' },
};
if (reason !== 'UNAUTHORISED') input.extensions.merchandize_dispute_properties = { issue_type: 'PRODUCT' };

const form = new FormData();
form.append('input', new Blob([JSON.stringify(input)], { type: 'application/json' }));

const r = await api('POST', '/v1/customer/disputes', {
  form,
  headers: { 'PayPal-Auth-Assertion': assertion },
});
print('Create dispute', r);
const self = r.body?.links?.find((l) => l.rel === 'self');
if (self) console.log(`\nDispute id: ${self.href.split('/').pop()}`);
