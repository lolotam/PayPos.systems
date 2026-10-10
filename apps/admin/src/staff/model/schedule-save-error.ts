import { t, type Locale } from '@pospay/i18n';
import { envelopeMessage } from '@/shared/api/api-error';

// رفض حد اليوم يذكر الحد والأيام المرفوضة (AS-1.2) حتى يعرف المدير أي يوم يصلحه.
export function scheduleSaveMessage(error: unknown, locale: Locale): string {
  const message = envelopeMessage(error, locale);
  const details = (error as { code?: unknown; details?: Record<string, unknown> } | null)?.details;
  if ((error as { code?: unknown } | null)?.code !== 'SCHEDULE_DAY_LIMIT_EXCEEDED' || !details)
    return message;
  const dates = Array.isArray(details.working_dates) ? details.working_dates : [];
  const detail = t(locale, 'shell.schedule_dayLimitDetail')
    .replace('{limit}', String(details.max_shifts_per_day))
    .replace('{dates}', dates.join(', '));
  return `${message} — ${detail}`;
}
