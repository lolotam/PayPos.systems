import type {
  AttendanceBoard,
  AttendanceChangeRequestPage,
  AttendanceChangeRequestInput,
} from '@pospay/contracts';
import { t, type Locale } from '@pospay/i18n';
import { envelopeMessage } from '@/shared/api/api-error';

export type AttendanceSession = AttendanceBoard['sessions'][number];
export type AttendanceRequestRow = AttendanceChangeRequestPage['items'][number];
export function attendanceActor(name: { ar: string | null; en: string } | null, locale: Locale) {
  return name
    ? locale === 'ar'
      ? (name.ar ?? name.en)
      : name.en
    : t(locale, 'attendanceActions.user');
}
export function attendanceActionError(error: unknown, locale: Locale, write = false) {
  const value = error as { code?: string; status?: number } | null;
  const code = value?.code;
  if (code?.startsWith('ATTENDANCE_')) return envelopeMessage(error, locale);
  if (value?.status === 401) return t(locale, 'attendanceBoard.sessionExpired');
  if (
    write &&
    (code === 'FORBIDDEN' ||
      code === 'NOT_FOUND' ||
      (!code && (value?.status === 403 || value?.status === 404)))
  )
    return t(locale, 'attendanceActions.permissionDenied');
  if (code === 'NOT_FOUND') return t(locale, 'attendanceActions.notFound');
  if (code === 'FEATURE_DISABLED') return t(locale, 'attendanceActions.featureDisabled');
  if (code === 'FORBIDDEN' && !(error as { message_en?: string }).message_en)
    return t(locale, 'attendanceActions.forbidden');
  return envelopeMessage(error, locale);
}
export function attendanceSessionActions(row: AttendanceSession) {
  return { correct: row.status !== 'OPEN' && row.source !== 'MANUAL', void: row.status !== 'OPEN' };
}
export function attendancePages<T extends { id: string }>(pages?: { items: T[] }[]): T[] {
  return [...new Map(pages?.flatMap((page) => page.items).map((row) => [row.id, row])).values()];
}
export function canRestoreAttendance(row: AttendanceRequestRow): boolean {
  return (
    row.kind === 'VOID_SESSION' &&
    row.status === 'APPROVED' &&
    Boolean(row.session_id) &&
    row.session_revision !== null &&
    row.session_state?.voided === true &&
    row.session_state.void_request_id === row.id &&
    row.session_state.restore_pending === false
  );
}

// القائمة تحفظ المراجعة قبل الإلغاء؛ نجاح الإلغاء يضيف واحدة، وأي تغيير لاحق يرفضه الخادم كمراجعة قديمة.
export function restoreAttendanceInput(
  row: AttendanceRequestRow,
  reason: string,
): AttendanceChangeRequestInput | null {
  if (!canRestoreAttendance(row) || !row.session_id || row.session_revision === null) return null;
  return {
    kind: 'RESTORE_SESSION',
    employee_id: row.employee.id,
    session_id: row.session_id,
    session_revision: row.session_revision + 1,
    reason,
  };
}
export function voidAttendanceInput(
  row: AttendanceSession,
  reason: string,
): AttendanceChangeRequestInput {
  return {
    kind: 'VOID_SESSION',
    employee_id: row.employee_id,
    session_id: row.id,
    session_revision: row.revision,
    reason,
  };
}
