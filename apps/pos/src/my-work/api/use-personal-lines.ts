import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import type { WorkContext } from '../model/work-context';
import { workForbidden } from '../model/work-error';
import { type OnRefused, useWorkLines } from './use-my-work';
import type { MountScope } from './use-mount-scope';
import { useReadThisVisit } from '@/shared/query/use-read-this-visit';

/**
 * خدمات موبايلها الشخصي ومعاها رفض الصلاحية (403) على أي صفحة، الأولى أو اللي بعدها: بيتسجّل في الحالة،
 * والقراءة بتتقفل، والصفحات المحمّلة بتتمسح من الكاش، فمفيش إعادة محاولة ولا صفوف ترجع. فشل النقل والسيرفر
 * بيفضل خطأ عادي بإعادة محاولة والصفوف ظاهرة. الحالة بتتصفّر لما الموظفة تغيّر الشهر.
 *
 * @param context مين بيفتح الشاشة
 * @param scope مساحة مفاتيح الزيارة الحالية
 * @param month الشهر المطلوب أو undefined للحالي
 * @param onRefused معالج انتهاء الجلسة (401)
 * @returns استعلام الصفحات، وهل نجحت قراءة السيرفر للشهر ده في الزيارة الحالية (قبلها الصفحات اللي في الكاش ما تتعرضش)،
 * وخطأ الرفض لو الشهر الحالي مرفوض، ودالة تصفير الرفض
 */
export function usePersonalLines(
  context: WorkContext,
  scope: MountScope,
  month: string | undefined,
  onRefused: OnRefused,
) {
  const cache = useQueryClient();
  const key = month ?? 'current';
  const [denied, setDenied] = useState<{ key: string; error: unknown }>();
  const deniedHere = denied?.key === key ? denied : undefined;
  const lines = useWorkLines(
    context,
    scope,
    month,
    (error) => {
      onRefused(error);
      if (workForbidden(error)) setDenied({ key, error });
    },
    deniedHere === undefined,
  );
  const proven = useReadThisVisit(`${context.identity}:lines:${key}`, lines, true);
  useEffect(() => {
    if (deniedHere) cache.removeQueries({ queryKey: [...scope, 'lines'] });
  }, [cache, scope, deniedHere]);
  return { lines, proven, deniedError: deniedHere?.error, resetDenied: () => setDenied(undefined) };
}
