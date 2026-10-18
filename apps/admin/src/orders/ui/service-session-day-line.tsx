'use client';
import type { ServiceSessionDayPage } from '@pospay/contracts';
import { parseMoney } from '@pospay/domain';
import { formatKwd, t, type Locale } from '@pospay/i18n';
import { Badge, Button } from '@pospay/ui';

type DayLine = ServiceSessionDayPage['items'][number]['lines'][number];
const shown = (locale: Locale, row: { name_ar: string | null; name_en: string }) => (locale === 'ar' ? row.name_ar ?? row.name_en : row.name_en);
const kwd = (value: string) => formatKwd(parseMoney(value));

// العلامة من edited فقط؛ إعادة توزيع المؤديات بترفع revision من غير ما تعلم السطر اتعدّل سعره (FR-019).
export function ServiceSessionDayLine({ line, locale, historyOpen, onEdit, onToggleHistory }: {
  line: DayLine; locale: Locale; historyOpen: boolean; onEdit: () => void; onToggleHistory: () => void;
}) {
  return <div className="grid gap-1 text-start">
    <p>{shown(locale, line)}{line.edited ? <Badge className="ms-2">{t(locale, 'serviceLineEdit.edited')}</Badge> : null}</p>
    <p>{t(locale, 'serviceSessions.price')} <bdi>{kwd(line.price)}</bdi></p>
    <p>{t(locale, 'serviceLineEdit.discount')} <bdi>{kwd(line.discount)}</bdi></p>
    <p>{t(locale, 'serviceLineEdit.net')} <bdi>{kwd(line.net)}</bdi></p>
    <p>{line.performers.map((performer) => shown(locale, performer)).join(', ')}</p>
    <div className="flex flex-wrap gap-2">
      {line.status === 'ACTIVE' ? <Button type="button" variant="outline" onClick={onEdit}>{t(locale, 'serviceLineEdit.edit')}</Button> : null}
      {line.edited ? <Button type="button" variant="outline" aria-expanded={historyOpen} onClick={onToggleHistory}>{t(locale, 'serviceLineEdit.history')}</Button> : null}
    </div>
  </div>;
}
