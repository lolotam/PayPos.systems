import type { OwnAttendance, PersonalBranches } from '@pospay/contracts';
import { personalApiClient, staffApiClient } from '@/shared/api/client';
import { PrivateViewHttpError } from '@/shared/private-view/errors';
import type { AttendanceContext } from '../model/attendance-context';

const HEADER = 'x-private-view-window-id';

export type AttendanceRead = {
  mode: AttendanceContext['mode'];
  month: string | undefined;
  windowId: string | undefined;
  signal: AbortSignal;
};

// الموبايل الشخصي بيستعمل كوكي الجلسة الشخصية بس، وجهاز الاستقبال بيستعمل توكن الجهاز وراه النافذة.
function client(mode: AttendanceContext['mode']) {
  return mode === 'reception' ? staffApiClient() : personalApiClient();
}

function windowHeader(read: AttendanceRead) {
  return read.windowId === undefined ? {} : { [HEADER]: read.windowId };
}

function value<T>(result: { data?: T; error?: unknown; response: Response }): T {
  if (result.data !== undefined) return result.data;
  const body = result.error as { code?: unknown } | undefined;
  throw new PrivateViewHttpError(
    typeof body?.code === 'string' ? body.code : 'NOT_READY',
    result.response.status,
  );
}

/** قراءات «حضوري» بالـ client المولّد؛ الموظفة بتتحدد من الجلسة في السيرفر مش من أي حقل هنا. */
export const attendanceCalls = {
  /**
   * جلسات الحضور للشهر المطلوب؛ من غير شهر السيرفر هو اللي بيحدد «الحالي» (FR-A04).
   *
   * @param read الشهر والنافذة (لو في نافذة) وإشارة الإلغاء
   * @returns الشهر وجلساته
   */
  own: async (read: AttendanceRead): Promise<OwnAttendance> =>
    value(
      await client(read.mode).GET('/v1/staff/me/attendance', {
        signal: read.signal,
        cache: 'no-store',
        params: { header: windowHeader(read), query: read.month ? { month: read.month } : {} },
      }),
    ),
  /**
   * فروع الموظفة وتوقيتاتها؛ المسار ده للجلسة الشخصية بس، وهو مصدر توقيت العرض على موبايلها.
   *
   * @param signal بيلغي الطلب لو الشاشة اتقفلت
   * @returns الفروع وتوقيتاتها
   */
  branches: async (signal: AbortSignal): Promise<PersonalBranches> =>
    value(await personalApiClient().GET('/v1/staff/me/branches', { signal, cache: 'no-store' })),
};
