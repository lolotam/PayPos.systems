import { useQuery } from '@tanstack/react-query';
import type { MountScope } from '@/shared/query/use-mount-scope';
import type { AttendanceContext } from '../model/attendance-context';
import { attendanceCalls } from './attendance-calls';

// القراءات ما بتتجددش لوحدها ولا بتفضل في الكاش بعد ما الشاشة تتقفل.
const PERSONAL_READ = {
  gcTime: 0,
  staleTime: 0,
  retry: false,
  refetchOnWindowFocus: false,
  refetchOnReconnect: false,
} as const;

/** رفض السيرفر على موبايلها الشخصي: بس انتهاء الجلسة (401) بيتعالج، وباقي الأخطاء بتظهر في الشاشة. */
export type OnRefused = (error: unknown) => void;

async function guarded<T>(read: () => Promise<T>, signal: AbortSignal, onRefused: OnRefused) {
  try {
    return await read();
  } catch (error) {
    if (!signal.aborted) onRefused(error);
    throw error;
  }
}

/**
 * جلسات حضور الشهر على موبايلها الشخصي، من غير PIN ومن غير كاش بعد ما الشاشة تتقفل.
 *
 * @param context مين بيفتح الشاشة
 * @param scope مساحة مفاتيح الزيارة الحالية
 * @param month الشهر المطلوب أو undefined للحالي
 * @param onRefused معالج انتهاء الجلسة (401)
 * @param enabled false لحد ما توقيت العرض يبقى معروف، فالقراءة بتتأجل مش بتتعرض بتوقيت غلط
 * @returns استعلام الجلسات
 */
export function useOwnAttendance(
  context: AttendanceContext,
  scope: MountScope,
  month: string | undefined,
  onRefused: OnRefused,
  enabled = true,
) {
  return useQuery({
    ...PERSONAL_READ,
    enabled,
    queryKey: [...scope, 'attendance', month ?? 'current'],
    queryFn: ({ signal }) =>
      guarded(
        () =>
          attendanceCalls.own({
            mode: context.mode,
            month,
            windowId: undefined,
            signal,
          }),
        signal,
        onRefused,
      ),
  });
}

/**
 * فروع الموظفة وتوقيتاتها؛ منها بتاخد الشاشة توقيت العرض على الموبايل الشخصي.
 *
 * @param scope مساحة مفاتيح الزيارة الحالية
 * @param onRefused معالج انتهاء الجلسة (401)
 * @returns استعلام الفروع
 */
export function useAttendanceBranches(scope: MountScope, onRefused: OnRefused) {
  return useQuery({
    ...PERSONAL_READ,
    queryKey: [...scope, 'branches'],
    queryFn: ({ signal }) => guarded(() => attendanceCalls.branches(signal), signal, onRefused),
  });
}
