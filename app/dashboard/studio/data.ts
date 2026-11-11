// AG Studio's data sources for the Vouch dashboard: disputes (with the agent's verdict and the
// money outcome), mandates and agent purchases, related through the mandate id, plus a calendar
// and calculated measures.

import type {
  AgDataSourcesDefinition,
  AgExpressionFieldDefinition,
  AgFieldDefinition,
  AgFormat,
  AgRelationDefinition,
} from 'ag-studio';
import type { VouchDashboardData } from '@/lib/vouch-dashboard-data';

const CALENDAR_ID = 'calendar';

// [id, name, format, hide?]
type FieldSpec = [id: string, name: string, format: AgFormat, hide?: boolean];

// Money is USD throughout, so currency fields get an explicit USD formatter ($1,234.50).
const USD = { format: new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }) };

const fields = (specs: FieldSpec[]): AgFieldDefinition[] =>
  specs.map(([id, name, format, hide]) => ({
    id,
    name,
    format,
    ...(format === 'currencyFormat' && { formatOptions: USD }),
    ...(hide && { hide }),
  }));

const manyToOne = (id: string, source: string, target: string): AgRelationDefinition => {
  const [sourceTable, sourceField] = source.split('.');
  const [targetTable, targetField] = target.split('.');
  return {
    id,
    source: { tableId: sourceTable, fieldId: sourceField },
    target: { tableId: targetTable, fieldId: targetField },
    type: 'many-to-one',
  };
};

const onCalendar = (tableId: string, fieldId: string): AgRelationDefinition => ({
  id: `${tableId}-${fieldId}-calendar`,
  source: { tableId, fieldId },
  target: { calendarId: CALENDAR_ID },
});

const sumOf = (id: string) => ({ id, aggregation: 'sum' as const });

const ratio = (id: string, name: string, description: string, numerator: string, denominator: string): AgExpressionFieldDefinition => ({
  id,
  name,
  description,
  format: 'percentageFormat',
  isMeasure: true,
  expression: { operator: 'divide', inputs: [sumOf(numerator), sumOf(denominator)] },
});

export const hasData = (data: VouchDashboardData) => data.disputes.length > 0 || data.mandates.length > 0;

export function buildStudioData(data: VouchDashboardData): AgDataSourcesDefinition {
  const dates = [...data.disputes.map((d) => d.openedDate), ...data.purchases.map((p) => p.date)].filter((d): d is string => !!d).sort();
  const today = data.asOf.slice(0, 10);

  return {
    description:
      'Vouch: PayPal disputes for a merchant whose customers shop through AI agents. Each agent purchase is bound by a buyer-approved ' +
      'mandate (category, spending limit, expiry). The dispute agent compares the purchase with the mandate: In mandate means fight, ' +
      'Out of mandate means refund. Money is in USD.',
    sources: [
      {
        id: 'disputes',
        description: 'One row per PayPal dispute with the latest agent recommendation. At risk = open disputes not yet conceded; recovered = won; refunded = lost or accepted.',
        data: data.disputes,
        fields: fields([
          ['id', 'Dispute', 'textFormat'],
          ['reason', 'Reason', 'textFormat'],
          ['status', 'PayPal Status', 'textFormat'],
          ['stage', 'Stage', 'textFormat'],
          ['result', 'Result', 'textFormat'],
          ['verdict', 'Verdict', 'textFormat'],
          ['action', 'Recommended Action', 'textFormat'],
          ['confidence', 'Confidence', 'percentageFormat'],
          ['submitted', 'Submitted', 'booleanFormat'],
          ['mandateId', 'Mandate ID', 'textFormat', true],
          ['openedDate', 'Opened', 'dateFormat'],
          ['deadline', 'Respond By', 'dateFormat'],
          ['daysLeft', 'Days Left', 'integerFormat'],
          ['currency', 'Currency', 'textFormat', true],
          ['amount', 'Disputed', 'currencyFormat'],
          ['atRisk', 'At Risk', 'currencyFormat'],
          ['recovered', 'Recovered', 'currencyFormat'],
          ['refunded', 'Refunded', 'currencyFormat'],
          ['decided', 'Decided', 'integerFormat', true],
          ['wonCount', 'Won', 'integerFormat', true],
          ['disputeCount', 'Disputes', 'integerFormat'],
          ['mandateBacked', 'Mandate-backed', 'integerFormat', true],
          ['inMandate', 'In-mandate', 'integerFormat', true],
        ]),
      },
      {
        id: 'mandates',
        description: 'Buyer-approved spending mandates. Signature valid = stored rules still match their fingerprint and Vouch HMAC.',
        data: data.mandates,
        fields: fields([
          ['id', 'Mandate', 'textFormat'],
          ['summary', 'Mandate Summary', 'textFormat'],
          ['category', 'Allowed Category', 'textFormat'],
          ['maxAmount', 'Spending Limit', 'currencyFormat'],
          ['status', 'Mandate Status', 'textFormat'],
          ['approvedDate', 'Approved', 'dateFormat'],
          ['expiresDate', 'Expires', 'dateFormat'],
          ['buyer', 'Buyer', 'textFormat'],
          ['signatureValid', 'Signature Valid', 'booleanFormat'],
          ['placedVia', 'Created Via', 'textFormat'],
        ]),
      },
      {
        id: 'purchases',
        description: 'Purchases made by shopping agents under a mandate.',
        data: data.purchases,
        fields: fields([
          ['id', 'Purchase', 'textFormat', true],
          ['mandateId', 'Mandate ID', 'textFormat', true],
          ['item', 'Item', 'textFormat'],
          ['category', 'Item Category', 'textFormat'],
          ['amount', 'Purchase Amount', 'currencyFormat'],
          ['withinMandate', 'Mandate Check', 'textFormat'],
          ['date', 'Purchased', 'dateFormat'],
          ['tracked', 'Tracked', 'booleanFormat'],
          ['placedVia', 'Bought Via', 'textFormat'],
          ['purchaseCount', 'Purchases', 'integerFormat'],
        ]),
      },
    ],
    relationships: [
      manyToOne('dispute-mandate', 'disputes.mandateId', 'mandates.id'),
      manyToOne('purchase-mandate', 'purchases.mandateId', 'mandates.id'),
      onCalendar('disputes', 'openedDate'),
      onCalendar('purchases', 'date'),
    ],
    calendars: [
      {
        id: CALENDAR_ID,
        label: 'Calendar',
        range: { from: { type: 'date', value: dates[0] ?? today }, to: { type: 'date', value: dates.at(-1) ?? today } },
        fragments: ['year', 'quarter', 'month', 'week', 'day', 'dayOfWeek'],
      },
    ],
    expressions: [
      ratio('winRate', 'Win Rate', 'Disputes won / disputes Vouch fought that PayPal has decided. Honest refunds are not losses.', 'disputes.wonCount', 'disputes.decided'),
      ratio('mandateMatchRate', 'Mandate Match Rate', 'Share of disputes whose purchase satisfied its mandate.', 'disputes.inMandate', 'disputes.disputeCount'),
      ratio('mandateCoverage', 'Mandate Coverage', 'Share of disputes backed by an agent mandate.', 'disputes.mandateBacked', 'disputes.disputeCount'),
    ],
  };
}
