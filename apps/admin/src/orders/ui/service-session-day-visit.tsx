'use client';
import type { ServiceSessionDayPage } from '@pospay/contracts';
import { formatInstant, t, type Locale } from '@pospay/i18n';
import { Badge, Card } from '@pospay/ui';
import type { ReactNode } from 'react';
import { ServiceSessionDayLine } from './service-session-day-line';

type Visit = ServiceSessionDayPage['items'][number];

export function ServiceSessionDayVisit({ visit, locale, activeLineId, historyLineId, onEdit, onToggleHistory, editor, historyPanel }: {
  visit: Visit; locale: Locale; activeLineId: string | null; historyLineId: string | null;
  onEdit: (lineId: string) => void; onToggleHistory: (lineId: string) => void; editor: ReactNode; historyPanel: ReactNode;
}) {
  return <Card className="grid gap-3 p-3 text-start">
    <p>{visit.customer.name}</p>
    <p>{formatInstant(new Date(visit.occurred_at), locale, visit.business_timezone)}</p>
    {visit.late || visit.lines.some((line) => line.late) ? <Badge variant="warning">{t(locale, 'serviceSessions.late')}</Badge> : null}
    {visit.lines.map((line) => <div key={line.id} className="grid gap-2">
      <ServiceSessionDayLine line={line} locale={locale} historyOpen={historyLineId === line.id} onEdit={() => onEdit(line.id)} onToggleHistory={() => onToggleHistory(line.id)} />
      {activeLineId === line.id ? editor : null}
      {historyLineId === line.id ? historyPanel : null}
    </div>)}
  </Card>;
}
