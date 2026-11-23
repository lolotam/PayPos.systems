import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import type { WorkContext } from '../model/work-context';
import { workForbidden } from '../model/work-error';
import { type OnRefused, useWorkLines } from './use-my-work';

/**
 * خدمات موبايلها الشخصي ومعاها رفض الصلاحية (403) على أي صفحة، الأولى أو اللي بعدها: بيتسجّل في الحالة،
 * والقراءة بتتقفل، والصفحات المحمّلة بتتمسح من الكاش، فمفيش إعادة محاولة ولا صفوف ترجع. فشل النقل والسيرفر
 * بيفضل خطأ عادي بإعادة محاولة والصفوف ظاهرة. الحالة بتتصفّر لما الموظفة تغيّر الشهر.
 *
 * @param context مين بيفتح الشاشة
 * @param month الشهر المطلوب أو undefined للحالي
 * @param onRefused معالج انتهاء الجلسة (401)
 * @returns استعلام الصفحات، وخطأ الرفض لو الشهر الحالي مرفوض، ودالة تصفير الرفض
 */
export function usePersonalLines(
  context: WorkContext,
  month: string | undefined,
  onRefused: OnRefused,
) {
  const cache = useQueryClient();
  const key = month ?? 'current';
  const [denied, setDenied] = useState<{ key: string; error: unknown }>();
  const deniedHere = denied?.key === key ? denied : undefined;
  const lines = useWorkLines(
    context,
    month,
    (error) => {
      onRefused(error);
      if (workForbidden(error)) setDenied({ key, error });
    },
    deniedHere === undefined,
  );
  useEffect(() => {
    if (deniedHere) cache.removeQueries({ queryKey: ['my-work', context.identity, 'lines'] });
  }, [cache, context.identity, deniedHere]);
  return { lines, deniedError: deniedHere?.error, resetDenied: () => setDenied(undefined) };
}
