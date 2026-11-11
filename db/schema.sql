-- Vouch schema. Idempotent: safe to run on every boot (npm run db:migrate).

CREATE TABLE IF NOT EXISTS mandates (
  id               TEXT PRIMARY KEY,
  raw_text         TEXT NOT NULL,
  rules            JSONB NOT NULL,            -- { category, maxAmount, currency, expiresAt, ... }
  summary          TEXT NOT NULL,             -- human-readable line shown in the buyer's PayPal record
  hash             TEXT NOT NULL,             -- sha256 of canonical rules JSON; also PayPal custom_id
  signature        TEXT NOT NULL,             -- HMAC(hash, MANDATE_SIGNING_SECRET)
  order_id         TEXT,
  authorization_id TEXT,
  buyer_email      TEXT,
  approved_at      TIMESTAMPTZ,
  status           TEXT NOT NULL DEFAULT 'DRAFT',  -- DRAFT | APPROVED | AUTHORIZED | USED | EXPIRED
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS agent_decisions (
  id          BIGSERIAL PRIMARY KEY,
  mandate_id  TEXT REFERENCES mandates(id),
  dispute_id  TEXT,                            -- set for dispute-agent steps
  agent       TEXT NOT NULL,                   -- 'shopper' | 'dispute'
  step        INT NOT NULL,
  tool        TEXT,
  input       JSONB,
  output      JSONB,
  reasoning   TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS agent_decisions_mandate ON agent_decisions(mandate_id);
CREATE INDEX IF NOT EXISTS agent_decisions_dispute ON agent_decisions(dispute_id);

CREATE TABLE IF NOT EXISTS purchases (
  id               TEXT PRIMARY KEY,
  mandate_id       TEXT REFERENCES mandates(id),
  item_id          TEXT NOT NULL,
  item_name        TEXT NOT NULL,
  category         TEXT,
  amount           NUMERIC(12,2) NOT NULL,
  currency         TEXT NOT NULL DEFAULT 'USD',
  capture_id       TEXT UNIQUE,                -- seller transaction id; matches dispute seller_transaction_id
  in_mandate       BOOLEAN,                    -- result of check_mandate at purchase time
  tracking_number  TEXT,
  carrier          TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS disputes (
  id                 TEXT PRIMARY KEY,         -- PayPal dispute id (PP-R-... / PP-D-...)
  seller_txn_id      TEXT,
  buyer_txn_id       TEXT,
  reason             TEXT,
  status             TEXT,
  stage              TEXT,
  amount             NUMERIC(12,2),
  currency           TEXT,
  deadline           TIMESTAMPTZ,
  outcome            TEXT,
  raw                JSONB NOT NULL,
  created_at         TIMESTAMPTZ,
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS disputes_seller_txn ON disputes(seller_txn_id);

CREATE TABLE IF NOT EXISTS recommendations (
  id            BIGSERIAL PRIMARY KEY,
  dispute_id    TEXT NOT NULL REFERENCES disputes(id),
  verdict       TEXT NOT NULL,                 -- IN_MANDATE | OUT_OF_MANDATE | UNKNOWN
  action        TEXT NOT NULL,                 -- FIGHT | OFFER | ACCEPT
  confidence    NUMERIC(4,3),
  explanation   TEXT,
  draft         TEXT,
  offer_amount  NUMERIC(12,2),
  evidence      JSONB,
  approved_at   TIMESTAMPTZ,
  submitted_at  TIMESTAMPTZ,
  result        JSONB,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS recommendations_dispute ON recommendations(dispute_id);

CREATE TABLE IF NOT EXISTS webhook_events (
  id            TEXT PRIMARY KEY,              -- PayPal event id (dedupes retries)
  event_type    TEXT NOT NULL,
  verification  TEXT,
  payload       JSONB NOT NULL,
  received_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Where a mandate or purchase came from: NULL = the Vouch web app, 'mcp' = an external agent via
-- the MCP server (/api/mcp). source_client is the MCP client's name when it sends one.
ALTER TABLE mandates  ADD COLUMN IF NOT EXISTS source TEXT;
ALTER TABLE mandates  ADD COLUMN IF NOT EXISTS source_client TEXT;
ALTER TABLE purchases ADD COLUMN IF NOT EXISTS source TEXT;
