'use client';
import type { ServiceSessionDayPage } from '@pospay/contracts';
import { formatInstant, t, type Locale } from '@pospay/i18n';
import { Badge, Card } from '@pospay/ui';
import type { ReactNode } from 'react';
import { ServiceSessionDayLine } from './service-session-day-line';

type Visit = ServiceSessionDayPage['items'][number];
export type DayVisitHandlers = {
  onEdit: (lineId: string) => void; onCancel: (lineId: string) => void; onChangePerformers: (lineId: string) => void;
  onToggleHistory: (lineId: string) => void; onToggleDetails: (lineId: string) => void; onTogglePerformerHistory: (lineId: string) => void;
};
export type DayVisitPanels = { editor: ReactNode; historyPanel: ReactNode; detailsPanel: ReactNode; performerHistoryPanel: ReactNode };

export function ServiceSessionDayVisit({ visit, locale, zoneFallback, canCancel, activeLineId, historyLineId, detailsLineId, performerHistoryLineId, handlers, panels, tipAction = null }: {
  visit: Visit; locale: Locale; zoneFallback: string; canCancel: boolean; activeLineId: string | null; historyLineId: string | null; detailsLineId: string | null;
  performerHistoryLineId: string | null; handlers: DayVisitHandlers; panels: DayVisitPanels; tipAction?: ReactNode;
}) {
  return <Card className="grid gap-3 p-3 text-start">
    <p>{visit.customer.name}</p>
    {tipAction}
    <p>{formatInstant(new Date(visit.occurred_at), locale, visit.business_timezone)}</p>
    {visit.late || visit.lines.some((line) => line.late) ? <Badge variant="warning">{t(locale, 'serviceSessions.late')}</Badge> : null}
    {visit.lines.map((line) => <div key={line.id} className="grid gap-2">
      <ServiceSessionDayLine line={line} locale={locale} timezone={visit.business_timezone || zoneFallback} canCancel={canCancel}
        historyOpen={historyLineId === line.id} detailsOpen={detailsLineId === line.id} performerHistoryOpen={performerHistoryLineId === line.id}
        handlers={{
          onEdit: () => handlers.onEdit(line.id), onCancel: () => handlers.onCancel(line.id), onChangePerformers: () => handlers.onChangePerformers(line.id),
          onToggleHistory: () => handlers.onToggleHistory(line.id), onToggleDetails: () => handlers.onToggleDetails(line.id),
          onTogglePerformerHistory: () => handlers.onTogglePerformerHistory(line.id),
        }} />
      {activeLineId === line.id ? panels.editor : null}
      {historyLineId === line.id ? panels.historyPanel : null}
      {detailsLineId === line.id ? panels.detailsPanel : null}
      {performerHistoryLineId === line.id ? panels.performerHistoryPanel : null}
    </div>)}
  </Card>;
}
