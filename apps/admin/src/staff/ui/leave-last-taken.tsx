'use client';
import type { LeaveHistoryPage } from '@pospay/contracts';
import { formatDate, t, type Locale, type MessageKey } from '@pospay/i18n';
import { useLocale } from '@/shared/locale/locale-context';

type Range = { from: string; to: string } | null | undefined;

function dateValue(value: string, locale: Locale): string {
  return formatDate(new Date(`${value}T12:00Z`), {
    locale,
    calendar: 'gregorian',
    timeZone: 'UTC',
  });
}

function rangeValue(range: Range, locale: Locale): string {
  if (!range) return t(locale, 'leaveHistory.none');
  const from = dateValue(range.from, locale);
  return range.from === range.to ? from : `${from} – ${dateValue(range.to, locale)}`;
}

export function LeaveLastTaken({
  lastTaken,
  showAbsence,
}: {
  lastTaken: LeaveHistoryPage['last_taken'] | undefined;
  showAbsence: boolean;
}) {
  const locale = useLocale();
  if (!lastTaken) return null;
  const items: { label: MessageKey; value: string }[] = [
    { label: 'leaveHistory.lastAnnual', value: rangeValue(lastTaken.annual, locale) },
    { label: 'leaveHistory.lastSick', value: rangeValue(lastTaken.sick, locale) },
    { label: 'leaveHistory.lastUnpaid', value: rangeValue(lastTaken.unpaid, locale) },
  ];
  if (showAbsence) {
    items.push({
      label: 'leaveHistory.lastAbsence',
      value: lastTaken.unexcused_absence
        ? dateValue(lastTaken.unexcused_absence, locale)
        : t(locale, 'leaveHistory.none'),
    });
  }
  return (
    <p>
      {items.map((item, index) => (
        <span key={item.label}>
          {index > 0 ? ' · ' : ''}
          {t(locale, item.label)}: {item.value}
        </span>
      ))}
    </p>
  );
}
