import { type PrivateViewData, PrivateViewController } from '@/shared/private-view/controller';
import type { PrivateViewDeps } from '@/shared/private-view/env';
import type { Scope, WindowHost } from '@/shared/private-view/host';
import { attendanceCalls } from './attendance-calls';
import {
  type AttendanceAction,
  type AttendanceData,
  EMPTY_ATTENDANCE,
  reduceAttendanceData,
} from '../model/attendance-window-state';

type AttendanceHost = WindowHost<AttendanceAction>;

/**
 * قراءة جلسات الشهر من نافذة العرض الخاص؛ رفض الصلاحية (403) وانتهاء الجلسة (401) بيتعاملوا معاهم
 * المتحكم (بيرجّعوا لخطوة الـ PIN أو بيخرجوا)، وأي خطأ تاني بيظهر في الشاشة بإعادة محاولة.
 *
 * @param host المتحكم
 * @param scope نطاق الطلب
 */
async function loadAttendance(host: AttendanceHost, scope: Scope): Promise<void> {
  try {
    const result = await attendanceCalls.own({
      mode: 'reception',
      month: scope.month,
      windowId: scope.windowId,
      signal: scope.signal,
    });
    host.commitData(scope, { type: 'loaded', month: result.month, sessions: result.sessions });
  } catch (error) {
    if (host.refused(scope, error)) return;
    host.commitData(scope, { type: 'failed', error });
  }
}

/**
 * نافذة «حضوري» على جهاز الاستقبال: نفس متحكم النافذة المشترك بتاع «شغلي»، بس القراءة جلسات الحضور
 * ومن غير كاش ولا تخزين (MY-13b).
 */
export class AttendanceWindowController extends PrivateViewController<AttendanceData, AttendanceAction> {
  constructor(deps: PrivateViewDeps, onLeave: () => void) {
    super(deps, onLeave, attendanceData());
  }

  stepMonth(month: string | undefined): void {
    this.restartReads({ type: 'month', month });
  }

  retry(): void {
    this.restartReads({ type: 'retry' });
  }
}

/** بيانات «حضوري» الخاصة بالنافذة: الشكل والمطالعة بيخصّوا «حضوري» نفسه. */
function attendanceData(): PrivateViewData<AttendanceData, AttendanceAction> {
  return {
    empty: EMPTY_ATTENDANCE,
    reduce: reduceAttendanceData,
    month: (data) => data.month,
    load: (host, scope) => loadAttendance(host, scope),
  };
}
