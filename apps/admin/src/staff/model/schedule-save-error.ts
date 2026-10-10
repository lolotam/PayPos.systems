import { t, type Locale } from '@pospay/i18n';
import { envelopeMessage } from '@/shared/api/api-error';
import { scheduleDayKeys } from './schedule-form';

type Details = Record<string, unknown>;

// رفض حد اليوم يذكر الحد والأيام المرفوضة (AS-1.2) حتى يعرف المدير أي يوم يصلحه.
function dayLimitDetail(details: Details, locale: Locale): string {
  const dates = Array.isArray(details.working_dates) ? details.working_dates : [];
  return t(locale, 'shell.schedule_dayLimitDetail')
    .replace('{limit}', String(details.max_shifts_per_day))
    .replace('{dates}', dates.join(', '));
}

// رفض البريك يسمّي الوردية بيومها وبدايتها، لأن الأسبوع ممكن يكون فيه كذا وردية ببريك.
function breakDetail(details: Details, locale: Locale): string | null {
  const key = typeof details.day === 'number' ? scheduleDayKeys[details.day] : undefined;
  if (!key || typeof details.start !== 'string') return null;
  return t(locale, 'shell.schedule_breakDetail')
    .replace('{day}', t(locale, `shell.schedule_${key}`))
    .replace('{start}', details.start);
}

export function scheduleSaveMessage(error: unknown, locale: Locale): string {
  const message = envelopeMessage(error, locale);
  const { code, details } = (error ?? {}) as { code?: unknown; details?: Details };
  if (!details) return message;
  const detail =
    code === 'SCHEDULE_DAY_LIMIT_EXCEEDED'
      ? dayLimitDetail(details, locale)
      : code === 'SCHEDULE_BREAK_INVALID'
        ? breakDetail(details, locale)
        : null;
  return detail ? `${message} — ${detail}` : message;
}
