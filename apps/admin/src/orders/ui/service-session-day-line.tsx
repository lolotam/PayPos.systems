'use client';
import type { ServiceSessionDayPage } from '@pospay/contracts';
import { parseMoney } from '@pospay/domain';
import { formatDate, formatInstant, formatKwd, t, type Locale } from '@pospay/i18n';
import { Badge, Button } from '@pospay/ui';

type DayLine = ServiceSessionDayPage['items'][number]['lines'][number];
const shown = (locale: Locale, row: { name_ar: string | null; name_en: string }) => (locale === 'ar' ? row.name_ar ?? row.name_en : row.name_en);
const kwd = (value: string) => formatKwd(parseMoney(value));
// performers_changed_at يوم تقويمي في منطقة النشاط؛ تحويله كلحظة بمنطقة الفرع كان ممكن يزحّق اليوم.
const civilDate = (day: string, locale: Locale) => formatDate(new Date(`${day}T12:00:00Z`), { locale, calendar: 'gregorian', timeZone: 'UTC' });

export type DayLineHandlers = {
  onEdit: () => void; onCancel: () => void; onChangePerformers: () => void;
  onToggleHistory: () => void; onToggleDetails: () => void; onTogglePerformerHistory: () => void;
};

// العلامة من edited فقط؛ إعادة توزيع المؤديات بترفع revision من غير ما تعلم السطر اتعدّل سعره (FR-019).
// علامة المنفّذين من performers_changed_at اللي السيرفر بيشتقها من السجل، مش من revision (FR-015).
export function ServiceSessionDayLine({ line, locale, timezone, canCancel, historyOpen, detailsOpen, performerHistoryOpen, handlers }: {
  line: DayLine; locale: Locale; timezone: string; canCancel: boolean; historyOpen: boolean; detailsOpen: boolean; performerHistoryOpen: boolean;
  handlers: DayLineHandlers;
}) {
  const cancelledAt = line.status === 'CANCELLED' && line.cancelled_at ? formatInstant(new Date(line.cancelled_at), locale, timezone) : null;
  const active = line.status === 'ACTIVE';
  return <div className="grid gap-1 text-start">
    <p>{shown(locale, line)}{line.edited ? <Badge className="ms-2">{t(locale, 'serviceLineEdit.edited')}</Badge> : null}{line.status === 'CANCELLED' ? <Badge className="ms-2">{t(locale, 'serviceLineCancel.cancelled')}</Badge> : null}</p>
    {line.performers_changed_at ? <p><Badge>{t(locale, 'serviceLinePerformers.changed')} <bdi>{civilDate(line.performers_changed_at, locale)}</bdi></Badge></p> : null}
    {line.status === 'CANCELLED' ? <Button type="button" variant="outline" aria-expanded={detailsOpen} onClick={handlers.onToggleDetails}>{t(locale, 'serviceLineCancel.details')}</Button> : null}
    <p>{t(locale, 'serviceSessions.price')} <bdi>{kwd(line.price)}</bdi></p>
    <p>{t(locale, 'serviceLineEdit.discount')} <bdi>{kwd(line.discount)}</bdi></p>
    <p>{t(locale, 'serviceLineEdit.net')} <bdi>{kwd(line.net)}</bdi></p>
    <p>{line.performers.map((performer) => shown(locale, performer)).join(', ')}</p>
    {cancelledAt ? <p>{cancelledAt}</p> : null}
    <div className="flex flex-wrap gap-2">
      {active ? <Button type="button" variant="outline" onClick={handlers.onEdit}>{t(locale, 'serviceLineEdit.edit')}</Button> : null}
      {active ? <Button type="button" variant="outline" onClick={handlers.onChangePerformers}>{t(locale, 'serviceLinePerformers.change')}</Button> : null}
      {canCancel && active ? <Button type="button" variant="outline" onClick={handlers.onCancel}>{t(locale, 'serviceLineCancel.cancel')}</Button> : null}
      {line.edited ? <Button type="button" variant="outline" aria-expanded={historyOpen} onClick={handlers.onToggleHistory}>{t(locale, 'serviceLineEdit.history')}</Button> : null}
      {line.performers_changed_at ? <Button type="button" variant="outline" aria-expanded={performerHistoryOpen} onClick={handlers.onTogglePerformerHistory}>{t(locale, 'serviceLinePerformers.history')}</Button> : null}
    </div>
  </div>;
}
