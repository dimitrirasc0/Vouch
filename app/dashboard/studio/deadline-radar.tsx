'use client';

// Custom AG Studio widget: "Dispute deadline radar". One card per dispute with the agent's verdict
// as a coloured badge, a countdown to PayPal's response deadline (red <= 3 days, amber <= 7) and the
// money at risk. Fields are mapped like any built-in widget, so it can be reconfigured in Edit mode,
// and clicking a card cross-filters the rest of the page.

import { useEffect, useState } from 'react';
import type { AgBaseWidgetDefinition, AgWidgetField, AgWidgetParams } from 'ag-studio';

type Mapping = { item: unknown; badge: unknown; daysLeft: unknown; amount: unknown };
type RadarWidget = { dataMapping: Mapping; format: { title?: { enabled?: boolean; text?: string } } };

export const DEADLINE_RADAR = 'vouch-deadline-radar';

// Result rows are keyed by each field's `key`; fall back to its field id.
function read(row: Record<string, unknown>, field: AgWidgetField | undefined): unknown {
  if (!field) return undefined;
  if (field.key in row) return row[field.key];
  if (field.fieldId in row) return row[field.fieldId];
  const key = Object.keys(row).find((k) => k.includes(field.fieldId));
  return key ? row[key] : undefined;
}

const BADGE: Record<string, { bg: string; fg: string }> = {
  'In mandate': { bg: 'rgba(0,135,90,0.12)', fg: '#00875a' },
  'Out of mandate': { bg: 'rgba(196,18,47,0.10)', fg: '#c4122f' },
  'No mandate': { bg: 'rgba(180,83,9,0.12)', fg: '#b45309' },
};

function countdown(days: number | null) {
  if (days === null || Number.isNaN(days)) return { text: 'closed', color: '#545d68', bg: '#f5f7fa' };
  if (days < 0) return { text: `${-days}d overdue`, color: '#fff', bg: '#c4122f' };
  if (days <= 3) return { text: `${days}d left`, color: '#fff', bg: '#c4122f' };
  if (days <= 7) return { text: `${days}d left`, color: '#fff', bg: '#b45309' };
  return { text: `${days}d left`, color: '#003087', bg: '#e6f0fc' };
}

function DeadlineRadar(props: AgWidgetParams) {
  const { dataMapping, widgetApi, format } = props;
  const m = dataMapping as Partial<Record<keyof Mapping, AgWidgetField[]>>;
  const fields = { item: m.item?.[0], badge: m.badge?.[0], daysLeft: m.daysLeft?.[0], amount: m.amount?.[0] };
  const [rows, setRows] = useState<Record<string, unknown>[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const key = JSON.stringify(dataMapping);

  useEffect(() => {
    const query = [fields.item, fields.badge, fields.daysLeft, fields.amount].filter((f): f is AgWidgetField => !!f);
    if (!fields.item) return;
    const controller = new AbortController();
    widgetApi
      .getData({ fields: query }, { signal: controller.signal })
      .then((res) => setRows(res.results.rows))
      .catch((err: Error) => !controller.signal.aborted && setError(err.message));
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, widgetApi]);

  const title = (format as RadarWidget['format'])?.title;
  const cards = (rows ?? [])
    .map((r) => {
      const days = read(r, fields.daysLeft);
      return {
        item: String(read(r, fields.item) ?? '-'),
        badge: String(read(r, fields.badge) ?? ''),
        days: days === null || days === undefined || days === '' ? null : Number(days),
        amount: read(r, fields.amount),
      };
    })
    // Open disputes first, nearest deadline first.
    .sort((a, b) => (a.days ?? Infinity) - (b.days ?? Infinity));

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', fontFamily: 'var(--pp-font)', padding: 12, boxSizing: 'border-box' }}>
      {title?.enabled !== false && (
        <div style={{ fontWeight: 700, fontSize: 14, color: '#001c64', marginBottom: 10 }}>{title?.text ?? 'Dispute deadline radar'}</div>
      )}
      {!fields.item && <div style={{ color: '#545d68', fontSize: 13 }}>Map a field to “Dispute” to show cards.</div>}
      {error && <div style={{ color: '#c4122f', fontSize: 13 }}>{error}</div>}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))', gap: 10, overflow: 'auto' }}>
        {cards.map((c) => {
          const cd = countdown(c.days);
          const b = BADGE[c.badge] ?? { bg: '#f5f7fa', fg: '#545d68' };
          return (
            <button
              key={c.item}
              type="button"
              onClick={() => fields.item && widgetApi.toggleCrossFilter({ type: 'value', field: fields.item, value: c.item, group: 0 })}
              style={{ textAlign: 'left', border: '1px solid #dbe1e8', borderRadius: 12, padding: 12, background: '#fff', cursor: 'pointer' }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 11, fontWeight: 700, padding: '3px 8px', borderRadius: 999, background: b.bg, color: b.fg }}>{c.badge || '—'}</span>
                <span style={{ fontSize: 11, fontWeight: 700, padding: '3px 8px', borderRadius: 999, background: cd.bg, color: cd.color }}>{cd.text}</span>
              </div>
              <div style={{ marginTop: 10, fontSize: 12, color: '#545d68', fontFamily: 'monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.item}</div>
              <div style={{ marginTop: 4, fontSize: 20, fontWeight: 600, color: '#001435' }}>
                {fields.amount ? widgetApi.formatFieldValue(fields.amount, c.amount as never) : ''}
              </div>
              <div style={{ fontSize: 11, color: '#545d68' }}>{fields.amount ? widgetApi.getFieldName(fields.amount) : ''}</div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

const icon =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>';

export const deadlineRadarWidget: AgBaseWidgetDefinition<typeof DEADLINE_RADAR, RadarWidget & { type: typeof DEADLINE_RADAR }> = {
  id: DEADLINE_RADAR,
  label: 'Dispute deadline radar',
  icon,
  dataMapping: {
    item: { type: 'field', supportedRoles: ['category'], required: true, aiDescription: 'The dispute identifier, one card per value.' },
    badge: { type: 'field', supportedRoles: ['category'], aiDescription: 'Category shown as a coloured badge, e.g. the agent verdict.' },
    daysLeft: { type: 'field', supportedRoles: ['numeric'], aiDescription: 'Days until the response deadline; drives the countdown colour.' },
    amount: { type: 'field', supportedRoles: ['numeric'], aiDescription: 'Money value shown large on each card, e.g. amount at risk.' },
  },
  form: (params) =>
    params.createDefaults({
      dataMappingItems: [
        { key: 'item', label: 'Dispute' },
        { key: 'badge', label: 'Badge' },
        { key: 'daysLeft', label: 'Days left' },
        { key: 'amount', label: 'Amount' },
      ],
    }),
  comp: DeadlineRadar,
  defaultSize: { width: 12, height: 14 },
  minSize: { width: 6, height: 8 },
} as AgBaseWidgetDefinition<typeof DEADLINE_RADAR, RadarWidget & { type: typeof DEADLINE_RADAR }>;
