// Studio's widget configuration: every built-in widget plus Vouch's custom ones, which also get
// their own group in the widget menu (Edit mode).
import type { AgWidgetsConfig } from 'ag-studio';
import { DEADLINE_RADAR, deadlineRadarWidget } from './deadline-radar';

export const vouchWidgets = (defaults: AgWidgetsConfig): AgWidgetsConfig =>
  ({
    ...defaults,
    widgets: [...defaults.widgets, deadlineRadarWidget],
    menu: [{ label: 'Vouch', widgetIds: [DEADLINE_RADAR] }, ...defaults.menu],
  }) as unknown as AgWidgetsConfig;
