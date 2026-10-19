'use client';
import type { ServiceSessionDayPage } from '@pospay/contracts';
import { formatInstant, t, type Locale } from '@pospay/i18n';
import { Badge, Card } from '@pospay/ui';
import type { ReactNode } from 'react';
import { ServiceSessionDayLine } from './service-session-day-line';

type Visit = ServiceSessionDayPage['items'][number];

export function ServiceSessionDayVisit({ visit, locale, zoneFallback, canCancel, activeLineId, historyLineId, detailsLineId, onEdit, onCancel, onToggleHistory, onToggleDetails, editor, historyPanel, detailsPanel, tipAction = null }: {
  visit: Visit; locale: Locale; zoneFallback: string; canCancel: boolean; activeLineId: string | null; historyLineId: string | null; detailsLineId: string | null;
  onEdit: (lineId: string) => void; onCancel: (lineId: string) => void; onToggleHistory: (lineId: string) => void; onToggleDetails: (lineId: string) => void; editor: ReactNode; historyPanel: ReactNode; detailsPanel: ReactNode; tipAction?: ReactNode;
}) {
  return <Card className="grid gap-3 p-3 text-start">
    <p>{visit.customer.name}</p>
    {tipAction}
    <p>{formatInstant(new Date(visit.occurred_at), locale, visit.business_timezone)}</p>
    {visit.late || visit.lines.some((line) => line.late) ? <Badge variant="warning">{t(locale, 'serviceSessions.late')}</Badge> : null}
    {visit.lines.map((line) => <div key={line.id} className="grid gap-2">
      <ServiceSessionDayLine line={line} locale={locale} timezone={visit.business_timezone || zoneFallback} canCancel={canCancel} historyOpen={historyLineId === line.id} detailsOpen={detailsLineId === line.id} onEdit={() => onEdit(line.id)} onCancel={() => onCancel(line.id)} onToggleHistory={() => onToggleHistory(line.id)} onToggleDetails={() => onToggleDetails(line.id)} />
      {activeLineId === line.id ? editor : null}
      {historyLineId === line.id ? historyPanel : null}
      {detailsLineId === line.id ? detailsPanel : null}
    </div>)}
  </Card>;
}
