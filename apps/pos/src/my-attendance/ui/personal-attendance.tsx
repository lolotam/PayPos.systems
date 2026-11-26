import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useMountScope } from '@/shared/query/use-mount-scope';
import { useReadThisVisit } from '@/shared/query/use-read-this-visit';
import { monthOutOfRange, sessionEnded } from '@/private-view/errors';
import { useAttendanceBranches, useOwnAttendance } from '../api/use-attendance';
import type { AttendanceContext } from '../model/attendance-context';
import { AttendanceMonth } from './attendance-month';

/**
 * «حضوري» على موبايلها الشخصي: من غير نافذة ولا PIN. القراءة بـ react-query بجلسة الكوكي، وأي 401 بيمسح
 * الكاش ويقفل الشاشة، والكاش بيتمسح كمان لما الشاشة تتفك (FR-A09: من غير إنترنت مفيش بيانات ولا حفظ محلي).
 *
 * @param props.context مين بيفتح الشاشة وهويتها
 * @param props.onLeave بتتنده لما الجلسة تتقفل (401)
 */
export function PersonalAttendance({
  context,
  onLeave,
}: {
  context: AttendanceContext;
  onLeave: () => void;
}) {
  const cache = useQueryClient();
  // كل تركيب للشاشة ليه مفاتيحه، فزيارتان على نفس الـ client ما بيتشاركوش في كاش ولا طلب شغال.
  const scope = useMountScope('my-attendance', context.identity);
  const identityKey = useMemo(() => ['my-attendance', context.identity] as const, [context.identity]);
  const clear = useCallback(
    (queryKey: readonly unknown[]) => {
      void cache.cancelQueries({ queryKey });
      cache.removeQueries({ queryKey });
    },
    [cache],
  );
  useEffect(() => () => clear(identityKey), [clear, identityKey]);
  const onRefused = (error: unknown) => {
    if (!sessionEnded(error)) return;
    // انتهاء الجلسة بيمسح بيانات الهوية كلها، مش بس زيارتي.
    clear(identityKey);
    onLeave();
  };
  // undefined = الشهر الحالي زي ما السيرفر بيحدده؛ المتصفح ما بيحسبوش من ساعته.
  const [month, setMonth] = useState<string>();
  const [home, setHome] = useState<string>();
  const branches = useAttendanceBranches(scope, onRefused);
  // القراءة بتستنى توقيت العرض: مفيش داعي نعرض ساعة بتوقيت غلط وبعدين نصحّحها.
  const attendance = useOwnAttendance(context, scope, month, onRefused, branches.isFetchedAfterMount);
  // بيانات الكاش من زيارة سابقة ما تتعرضش قبل ما السيرفر يرد بنجاح في الزيارة دي.
  const proven = useReadThisVisit(`${context.identity}:attendance:${month}`, attendance);
  const serverMonth = proven ? attendance.data?.month : undefined;
  if (month === undefined && serverMonth !== undefined && home !== serverMonth) setHome(serverMonth);
  const shown = serverMonth ?? month;
  const sessions = proven ? (attendance.data?.sessions ?? []) : [];
  const outOfRange = monthOutOfRange(attendance.error);
  return (
    <AttendanceMonth
      month={shown}
      home={home}
      sessions={sessions}
      status={attendance.isError ? 'error' : proven ? 'ready' : 'pending'}
      error={attendance.error}
      branches={branches.data?.items}
      timeZone={undefined}
      canGoBack={shown !== undefined && !attendance.isPending && !outOfRange}
      canGoForward={shown !== undefined && home !== undefined && shown !== home}
      onMonth={(next) => setMonth(next)}
      onRetry={() => void attendance.refetch()}
    />
  );
}
