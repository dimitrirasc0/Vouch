# Vouch — Dispute Defense Agent

An AI agent that defends small PayPal merchants against disputes and chargebacks. A PayPal
`CUSTOMER.DISPUTE.CREATED` webhook triggers a Claude agent. The agent investigates the case,
recommends whether to fight, offer a partial refund or accept, and drafts the evidence. The
merchant approves in one click, and the agent then submits the response through the PayPal
Disputes API.

Built for the PayPal AI Hackathon on top of the PayPal + AG Studio boilerplate
(see `BOILERPLATE_README.md`).

> Work in progress. Setup and run instructions are added as each part lands.

## Sandbox de-risk (step 1)

```bash
npm install
cp env.example .env              # fill in the sandbox app + buyer credentials
npm run pp:check                 # validates credentials, shows dispute scopes, lists disputes
npm run pp:pay -- create 49.99 "Ceramic mug set"   # prints a buyer approval link
npm run pp:pay -- capture <ORDER_ID>
npm run dev                      # webhook receiver at /api/webhooks/paypal
npm run pp:webhook -- https://<tunnel-host>/api/webhooks/paypal
```

## License

MIT, see [LICENSE](LICENSE).
