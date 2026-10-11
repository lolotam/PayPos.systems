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
export function attendanceActionError(error: unknown, locale: Locale) {
  const code = (error as { code?: string } | null)?.code;
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

// القائمة تحفظ المراجعة قبل الإلغاء؛ نجاح الإلغاء يضيف واحدة، وأي تغيير لاحق يرفضه الخادم كمراجعة قديمة.
export function restoreAttendanceInput(
  row: AttendanceRequestRow,
  reason: string,
): AttendanceChangeRequestInput | null {
  if (!row.session_id || row.session_revision === null) return null;
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
