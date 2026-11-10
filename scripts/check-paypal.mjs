// Step 1 de-risk: are the sandbox credentials valid, and which dispute scopes does the app have?
// Usage: node --env-file=.env scripts/check-paypal.mjs

import { api, print, token } from './_paypal.mjs';

const t = await token();
const scopes = t.scope.split(' ');
console.log(`OAuth OK. app_id=${t.app_id}, ${scopes.length} scopes.`);

const want = {
  'disputes/read-seller': 'read disputes (merchant)',
  'disputes/update-seller': 'provide evidence / make offer / accept claim (merchant)',
  'disputes/create': 'CREATE disputes as buyer (sandbox simulation; usually needs PayPal to grant it)',
  'disputes/read-buyer': 'read disputes (buyer)',
};
for (const [s, what] of Object.entries(want)) {
  const has = scopes.some((x) => x.endsWith(s));
  console.log(`  ${has ? 'YES' : ' no'}  ${s.padEnd(24)} ${what}`);
}
const other = scopes.filter((s) => s.includes('dispute') && !Object.keys(want).some((w) => s.endsWith(w)));
if (other.length) console.log('  other dispute scopes:', other.join(', '));

print('List disputes', await api('GET', '/v1/customer/disputes?page_size=10'));
print('Registered webhooks', await api('GET', '/v1/notifications/webhooks'));
