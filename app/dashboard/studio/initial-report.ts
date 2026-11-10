// The built-in "Vouch overview" report as AG Studio report state. Field ids ('disputes.atRisk')
// refer to the data sources in ./data.ts.

import type { AgPageState, AgReportState, AgWidgetLayoutState } from 'ag-studio';

const at = (xTrack: number, yTrack: number, xSpan: number, ySpan: number): AgWidgetLayoutState => ({ xTrack, yTrack, xSpan, ySpan });
const title = (text: string) => ({ title: { enabled: true, text } });
const sum = (id: string) => ({ id, aggregation: 'sum' as const });
const countd = (id: string) => ({ id, aggregation: 'countd' as const });

const PAYPAL_FONT = '"PayPal Open", "Helvetica Neue", Helvetica, Arial, sans-serif';
const typography = (fontSize: number, fontWeight: 'normal' | 'bold' = 'normal') => ({
  fontFamily: PAYPAL_FONT,
  fontSize,
  fontWeight,
  fontStyle: 'normal' as const,
});

const kpi = (text: string, value: { id: string; aggregation?: 'sum' | 'avg' | 'countd' }) => ({
  type: 'value' as const,
  dataMapping: { value: [value] },
  format: {
    title: { enabled: true, text, typography: typography(14, 'bold') },
    caption: { enabled: true, text: '', typography: typography(0) },
    style: { typography: typography(24) },
  },
});

const gauge = (text: string, id: string, caption: string) => ({
  type: 'radial-gauge' as const,
  dataMapping: { value: [{ id }] },
  format: {
    ...title(text),
    style: {
      scaleLabel: { min: 0, max: 1 },
      label: { typography: typography(24, 'bold') },
      secondaryLabel: { enabled: true, text: caption, typography: typography(12) },
    },
  },
});

const overview: AgPageState = {
  id: 'overview',
  widgets: {
    'kpi-at-risk': kpi('Money at risk', sum('disputes.atRisk')),
    'kpi-recovered': kpi('Recovered', sum('disputes.recovered')),
    'kpi-refunded': kpi('Refunded (agent fault)', sum('disputes.refunded')),
    'kpi-open': kpi('Disputes', countd('disputes.id')),
    'mandate-match': gauge('Mandate match rate', 'mandateMatchRate', 'of disputed purchases were within mandate'),
    'win-rate': gauge('Win rate', 'winRate', 'of decided disputes won'),
    'by-verdict': {
      type: 'column-chart-stacked',
      dataMapping: {
        categoryKey: [{ id: 'disputes.verdict' }],
        valueKey: [sum('disputes.amount')],
        legendKey: [{ id: 'disputes.result' }],
      },
      format: { ...title('Disputed amount by agent verdict and result'), style: { theme: { common: { legend: { enabled: true } } } } },
    },
    'by-reason': {
      type: 'donut-chart',
      dataMapping: { categoryKey: [{ id: 'disputes.reason' }], valueKey: [sum('disputes.amount')] },
      format: { ...title('By dispute reason'), style: { custom: { pieDataLabel: { enabled: true }, totalLabel: { enabled: true } } } },
    },
    'dispute-grid': {
      type: 'grid',
      dataMapping: {
        cols: [
          { id: 'disputes.id' },
          { id: 'disputes.reason' },
          { id: 'disputes.verdict' },
          { id: 'disputes.action' },
          { id: 'disputes.confidence' },
          { id: 'disputes.result' },
          { id: 'disputes.daysLeft' },
          { id: 'disputes.deadline' },
          sum('disputes.amount'),
          sum('disputes.atRisk'),
          sum('disputes.recovered'),
        ],
      },
      sort: [{ field: { id: 'disputes.daysLeft' }, direction: 'asc' }],
      format: title('Disputes, nearest deadline first'),
    },
  },
  widgetLayout: {
    'kpi-at-risk': at(0, 0, 6, 7),
    'kpi-recovered': at(6, 0, 6, 7),
    'kpi-refunded': at(12, 0, 6, 7),
    'kpi-open': at(18, 0, 6, 7),
    'by-verdict': at(0, 7, 12, 17),
    'mandate-match': at(12, 7, 6, 17),
    'win-rate': at(18, 7, 6, 17),
    'dispute-grid': at(0, 24, 16, 20),
    'by-reason': at(16, 24, 8, 20),
  },
};

const mandates: AgPageState = {
  id: 'mandates',
  widgets: {
    'kpi-mandates': kpi('Mandates approved', countd('mandates.id')),
    'kpi-spend': kpi('Agent spend', sum('purchases.amount')),
    'kpi-purchases': kpi('Agent purchases', sum('purchases.purchaseCount')),
    'check-split': {
      type: 'donut-chart',
      dataMapping: { categoryKey: [{ id: 'purchases.withinMandate' }], valueKey: [sum('purchases.amount')] },
      format: { ...title('Agent spend within vs outside mandate'), style: { custom: { pieDataLabel: { enabled: true }, totalLabel: { enabled: true } } } },
    },
    'by-item': {
      type: 'bar-chart-grouped',
      dataMapping: { categoryKey: [{ id: 'purchases.item' }], valueKey: [sum('purchases.amount')] },
      format: title('Spend by item'),
    },
    'mandate-grid': {
      type: 'grid',
      dataMapping: {
        cols: [
          { id: 'mandates.id' },
          { id: 'mandates.category' },
          sum('mandates.maxAmount'),
          { id: 'mandates.status' },
          { id: 'mandates.approvedDate' },
          { id: 'mandates.expiresDate' },
          { id: 'mandates.signatureValid' },
          { id: 'mandates.buyer' },
        ],
      },
      format: title('Mandates and signature verification'),
    },
    'purchase-grid': {
      type: 'grid',
      dataMapping: {
        cols: [{ id: 'purchases.date' }, { id: 'purchases.item' }, { id: 'purchases.category' }, sum('purchases.amount'), { id: 'purchases.withinMandate' }, { id: 'purchases.tracked' }, { id: 'mandates.category' }],
      },
      format: title('Agent purchases checked against their mandate'),
    },
  },
  widgetLayout: {
    'kpi-mandates': at(0, 0, 8, 7),
    'kpi-spend': at(8, 0, 8, 7),
    'kpi-purchases': at(16, 0, 8, 7),
    'check-split': at(0, 7, 10, 17),
    'by-item': at(10, 7, 14, 17),
    'mandate-grid': at(0, 24, 24, 14),
    'purchase-grid': at(0, 38, 24, 14),
  },
};

export const dashboardReport: AgReportState = {
  selectedPageId: 'overview',
  pages: [overview, mandates],
};
