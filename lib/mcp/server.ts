// Vouch as an MCP server: any AI agent (Claude, ChatGPT, Cursor, ...) can shop under a mandate the
// buyer approved in PayPal. Every tool is a thin wrapper around the code the web app already uses:
// parseMandate, createMandate, checkMandate, purchase and addTracking. The agent can never approve a
// mandate itself; it gets a link the buyer opens to approve the hold in PayPal.
import 'server-only';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { findItem, searchCatalog } from '../catalog';
import { one, query } from '../db';
import { checkMandate } from '../mandate';
import { MandateParseError, parseMandate } from '../mandate-parse';
import { createMandate, getMandate, type MandateRow } from '../mandates';
import { addTracking, MandateViolation, purchase, type PurchaseRow } from '../purchases';

export type McpContext = { baseUrl: string; client: string | null };

const ok = (data: unknown): CallToolResult => ({ content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] });
const fail = (message: string, data?: unknown): CallToolResult => ({
  isError: true,
  content: [{ type: 'text', text: JSON.stringify({ error: message, ...(data ? { details: data } : {}) }, null, 2) }],
});

// Every MCP call goes into the same decision trail the shopping agent writes, as agent 'mcp', so the
// mandate page and the dispute agent see what the external agent did.
async function trail(mandateId: string | null, tool: string, input: unknown, output: unknown, client: string | null) {
  const next = mandateId
    ? ((await one<{ n: number }>(`SELECT COALESCE(MAX(step), 0)::int + 1 AS n FROM agent_decisions WHERE mandate_id = $1`, [mandateId]))?.n ?? 1)
    : 1;
  await query(
    `INSERT INTO agent_decisions (mandate_id, agent, step, tool, input, output, reasoning) VALUES ($1,'mcp',$2,$3,$4,$5,$6)`,
    [mandateId, next, tool, JSON.stringify({ ...(input as object), via: 'MCP', client }), JSON.stringify(output), null],
  );
}

const splitRules = (m: MandateRow) => {
  const { notes, ...hard } = m.rules;
  return { hard_rules: hard, soft_preferences: notes ?? null };
};

const approvalUrl = (ctx: McpContext, id: string) => `${ctx.baseUrl}/mandates/${id}/approve`;

function purchaseView(p: PurchaseRow) {
  return {
    purchase_id: p.id,
    item_id: p.item_id,
    item: p.item_name,
    amount: p.amount,
    currency: p.currency,
    paypal_capture_id: p.capture_id,
    within_mandate: p.in_mandate,
    carrier: p.carrier,
    tracking_number: p.tracking_number,
    via: p.source === 'mcp' ? 'MCP' : 'Vouch web app',
    bought_at: p.created_at,
  };
}

export function createVouchMcpServer(ctx: McpContext) {
  const server = new McpServer(
    { name: 'vouch', title: 'Vouch: mandate-protected shopping', version: '0.1.0' },
    {
      instructions:
        'Vouch lets you buy for the user only within a mandate they approved in PayPal. Flow: create_mandate with their instructions -> give the user the approval_url and wait until they say they approved -> get_mandate_status to confirm -> search_catalog -> check_item_against_mandate -> purchase_within_mandate. Never claim a mandate is approved without checking get_mandate_status. Runs on the PayPal sandbox.',
    },
  );

  server.registerTool(
    'create_mandate',
    {
      title: 'Create a spending mandate',
      description:
        "Turn the user's plain-language shopping request (what to buy, max price, deadline) into strict mandate rules, and get a PayPal approval link. The user must open approval_url and approve the authorization hold in PayPal themselves; you cannot approve it for them. Nothing can be bought until they do.",
      inputSchema: {
        instructions: z
          .string()
          .min(5)
          .max(1000)
          .describe('The user\'s request in their own words, e.g. "Buy me a USB-C charger under $30 that arrives within 5 days"'),
      },
      annotations: { destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async ({ instructions }) => {
      try {
        const { rules } = await parseMandate(instructions);
        const created = await createMandate(instructions.trim(), rules);
        const m = (await one<MandateRow>(`UPDATE mandates SET source = 'mcp', source_client = $2 WHERE id = $1 RETURNING *`, [created.id, ctx.client]))!;
        const out = {
          mandate_id: m.id,
          status: 'AWAITING_BUYER_APPROVAL',
          summary: m.summary,
          ...splitRules(m),
          fingerprint: m.hash,
          approval_url: approvalUrl(ctx, m.id),
          next_step: `Ask the user to open approval_url and approve the $${rules.maxAmount.toFixed(2)} hold in PayPal (a hold, not a charge). Then call get_mandate_status.`,
        };
        await trail(m.id, 'create_mandate', { instructions }, out, ctx.client);
        return ok(out);
      } catch (err) {
        if (err instanceof MandateParseError) return fail(err.message);
        throw err;
      }
    },
  );

  server.registerTool(
    'get_mandate_status',
    {
      title: 'Get mandate status',
      description: 'Whether the user has approved the mandate in PayPal yet, its rules, spending limit and expiry, and what has been bought under it.',
      inputSchema: { mandateId: z.string().regex(/^mdt_[0-9a-f]+$/).describe('The mandate_id returned by create_mandate, e.g. mdt_9180328eebc5') },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ mandateId }) => {
      const m = await getMandate(mandateId);
      if (!m) return fail(`No mandate ${mandateId}`);
      const bought = await query<PurchaseRow>('SELECT * FROM purchases WHERE mandate_id = $1 ORDER BY created_at', [m.id]);
      const expired = new Date(m.rules.expiresAt) <= new Date();
      const approved = !!m.authorization_id;
      const out = {
        mandate_id: m.id,
        approved_by_buyer: approved,
        status: expired && m.status !== 'USED' ? 'EXPIRED' : m.status,
        can_purchase: approved && m.status === 'AUTHORIZED' && !expired,
        summary: m.summary,
        ...splitRules(m),
        spending_limit: { amount: m.rules.maxAmount, currency: m.rules.currency },
        expires_at: m.rules.expiresAt,
        approved_at: m.approved_at,
        paypal_order_id: m.order_id,
        paypal_authorization_id: m.authorization_id,
        purchases: bought.map(purchaseView),
        ...(approved ? {} : { approval_url: approvalUrl(ctx, m.id), next_step: 'The user has not approved yet. Ask them to open approval_url.' }),
        ...(m.status === 'USED' ? { note: 'This mandate allows one purchase and it has been used.' } : {}),
      };
      await trail(m.id, 'get_mandate_status', { mandateId }, { approved_by_buyer: out.approved_by_buyer, status: out.status }, ctx.client);
      return ok(out);
    },
  );

  server.registerTool(
    'search_catalog',
    {
      title: 'Search the store catalog',
      description: "Search the demo store's catalog. Returns items with id, name, category, price, currency and delivery days. Use the item id with check_item_against_mandate.",
      inputSchema: { query: z.string().min(1).max(200).describe('Keywords, e.g. "usb-c charger 45W"') },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ query: q }) => {
      const hits = searchCatalog(q);
      await trail(null, 'search_catalog', { query: q }, { results: hits.length }, ctx.client);
      return ok({ items: hits });
    },
  );

  server.registerTool(
    'check_item_against_mandate',
    {
      title: 'Check an item against the mandate',
      description:
        "Deterministically check whether buying an item right now satisfies the mandate's rules (category, currency, price limit, expiry, delivery date). Returns pass/fail with a reason for each rule. Call this before purchase_within_mandate.",
      inputSchema: {
        mandateId: z.string().regex(/^mdt_[0-9a-f]+$/).describe('The mandate_id, e.g. mdt_9180328eebc5'),
        itemId: z.string().min(1).describe('A catalog item id from search_catalog, e.g. chg-voltleaf-65'),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ mandateId, itemId }) => {
      const m = await getMandate(mandateId);
      if (!m) return fail(`No mandate ${mandateId}`);
      const item = findItem(itemId);
      if (!item) return fail(`Unknown item ${itemId}. Use an id from search_catalog.`);
      const result = checkMandate(m.rules, item);
      const out = { mandate_id: m.id, item_id: item.id, item: item.name, price: item.price, pass: result.pass, checks: result.checks };
      await trail(m.id, 'check_item_against_mandate', { mandateId, itemId }, out, ctx.client);
      return ok(out);
    },
  );

  server.registerTool(
    'purchase_within_mandate',
    {
      title: 'Buy an item within the mandate',
      description:
        "Buy one item for the user. Succeeds only if the user approved the mandate in PayPal AND the item passes every mandate rule; then PayPal captures the item's price from the hold (the rest is released) and shipment tracking is added. Refused with the failing rules otherwise. A mandate allows one purchase.",
      inputSchema: {
        mandateId: z.string().regex(/^mdt_[0-9a-f]+$/).describe('The mandate_id, e.g. mdt_9180328eebc5'),
        itemId: z.string().min(1).describe('A catalog item id from search_catalog, e.g. chg-voltleaf-65'),
      },
      annotations: { destructiveHint: true, idempotentHint: false, openWorldHint: true },
    },
    async ({ mandateId, itemId }) => {
      const input = { mandateId, itemId };
      const refuse = async (message: string, details?: unknown) => {
        await trail(m ? m.id : null, 'purchase_within_mandate', input, { refused: message, ...(details ? { details } : {}) }, ctx.client);
        return fail(message, details);
      };
      const m = await getMandate(mandateId);
      if (!m) return fail(`No mandate ${mandateId}`);
      if (!m.authorization_id || m.status === 'DRAFT')
        return refuse(`Refused: the user has not approved mandate ${m.id} in PayPal yet. Ask them to open ${approvalUrl(ctx, m.id)}.`);
      if (m.status === 'USED') return refuse(`Refused: mandate ${m.id} has already been used for a purchase.`);
      if (!findItem(itemId)) return refuse(`Refused: unknown item ${itemId}.`);

      try {
        const { purchase: p, captureStatus } = await purchase(m.id, itemId);
        await query(`UPDATE purchases SET source = 'mcp' WHERE id = $1`, [p.id]);
        const tracked = (await addTracking(p.id)) ?? p;
        const out = {
          ...purchaseView({ ...tracked, source: 'mcp' }),
          paypal_status: captureStatus,
          paypal_order_id: m.order_id,
          paypal_authorization_id: m.authorization_id,
          mandate_page: `${ctx.baseUrl}/mandates/${m.id}`,
          note: "Captured only the item's price from the buyer's PayPal hold; the rest was released.",
        };
        await trail(m.id, 'purchase_within_mandate', input, out, ctx.client);
        return ok(out);
      } catch (err) {
        if (err instanceof MandateViolation)
          return refuse(`Refused: this item breaks the mandate (${err.check.checks.filter((c) => !c.pass).map((c) => c.rule).join(', ')}). Nothing was charged.`, err.check.checks);
        return refuse(`Purchase failed: ${(err as Error).message}`);
      }
    },
  );

  return server;
}
