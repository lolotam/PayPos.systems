import type { AttendanceDeviceRefusalPage } from '@pospay/contracts';
import { formatInstant, t, type Locale } from '@pospay/i18n';

export function boardTime(instant: string | null, locale: Locale, timezone: string): string {
  return instant
    ? formatInstant(new Date(instant), locale, timezone)
    : t(locale, 'attendanceBoard.unavailable');
}
export function stillIn(clockIn: string, generatedAt: string): string {
  const minutes = Math.max(0, Math.floor((Date.parse(generatedAt) - Date.parse(clockIn)) / 60_000));
  return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}`;
}
export function boardError(error: unknown, locale: Locale): string {
  const value = error as { code?: string; status?: number } | null;
  const code = value?.code;
  if (value?.status === 401) return t(locale, 'attendanceBoard.sessionExpired');
  if (code === 'NOT_FOUND') return t(locale, 'attendanceBoard.notFound');
  if (code === 'FEATURE_DISABLED') return t(locale, 'attendanceBoard.featureDisabled');
  return t(locale, 'admin.unexpected');
}
export function boardAccessLost(error: unknown): boolean {
  const value = error as { code?: string; status?: number } | null;
  return (
    value?.code === 'FEATURE_DISABLED' ||
    value?.status === 401 ||
    value?.status === 403 ||
    value?.status === 404
  );
}
export function boardEmployeeName(
  employee: AttendanceDeviceRefusalPage['items'][number]['holder'],
  locale: Locale,
): string {
  if (employee) return locale === 'ar' ? (employee.name_ar ?? employee.name_en) : employee.name_en;
  return t(locale, 'attendanceBoard.unavailable');
}
