import { attendanceHoursMinutes } from '@pospay/domain';
import { t, type Locale } from '@pospay/i18n';

export function signedAttendanceHours(minutes: number): string {
  return `${minutes > 0 ? '+' : ''}${attendanceHoursMinutes(minutes)}`;
}
export function attendanceReportError(error: unknown, locale: Locale): string {
  const value = error as { code?: string; status?: number } | null;
  const code = value?.code;
  if (value?.status === 401) return t(locale, 'attendanceReport.sessionExpired');
  if (code === 'NOT_FOUND') return t(locale, 'attendanceReport.notFound');
  if (code === 'FEATURE_DISABLED') return t(locale, 'attendanceReport.featureDisabled');
  return t(locale, 'admin.unexpected');
}
