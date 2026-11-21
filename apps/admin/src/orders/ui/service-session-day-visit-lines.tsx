'use client';
import type { ServiceSessionDayPage } from '@pospay/contracts';
import type { Locale } from '@pospay/i18n';
import type { ReactNode } from 'react';
import { ServiceSessionDayLine } from './service-session-day-line';

type Visit = ServiceSessionDayPage['items'][number];
export type DayVisitHandlers = {
  onEdit: (lineId: string) => void;
  onCancel: (lineId: string) => void;
  onChangePerformers: (lineId: string) => void;
  onToggleHistory: (lineId: string) => void;
  onToggleDetails: (lineId: string) => void;
  onTogglePerformerHistory: (lineId: string) => void;
};

/**
 * سطور الزيارة الواحدة في قايمة اليوم: كل سطر بحالاته ولوحاته، مفصولة عن كارت الزيارة نفسه.
 */
export function VisitLines({
  visit,
  locale,
  zoneFallback,
  canCancel,
  canChangePerformers,
  activeLineId,
  historyLineId,
  detailsLineId,
  performerHistoryLineId,
  handlers,
  panels,
}: {
  visit: Visit;
  locale: Locale;
  zoneFallback: string;
  canCancel: boolean;
  canChangePerformers: boolean;
  activeLineId: string | null;
  historyLineId: string | null;
  detailsLineId: string | null;
  performerHistoryLineId: string | null;
  handlers: DayVisitHandlers;
  panels: { editor: ReactNode; historyPanel: ReactNode; detailsPanel: ReactNode; performerHistoryPanel: ReactNode };
}) {
  return (
    <>
      {visit.lines.map((line) => (
        <div key={line.id} className="grid gap-2">
          <ServiceSessionDayLine
            line={line}
            locale={locale}
            timezone={visit.business_timezone || zoneFallback}
            canCancel={canCancel}
            canChangePerformers={canChangePerformers}
            historyOpen={historyLineId === line.id}
            detailsOpen={detailsLineId === line.id}
            performerHistoryOpen={performerHistoryLineId === line.id}
            handlers={{
              onEdit: () => handlers.onEdit(line.id),
              onCancel: () => handlers.onCancel(line.id),
              onChangePerformers: () => handlers.onChangePerformers(line.id),
              onToggleHistory: () => handlers.onToggleHistory(line.id),
              onToggleDetails: () => handlers.onToggleDetails(line.id),
              onTogglePerformerHistory: () => handlers.onTogglePerformerHistory(line.id),
            }}
          />
          {activeLineId === line.id ? panels.editor : null}
          {historyLineId === line.id ? panels.historyPanel : null}
          {detailsLineId === line.id ? panels.detailsPanel : null}
          {performerHistoryLineId === line.id ? panels.performerHistoryPanel : null}
        </div>
      ))}
    </>
  );
}
