'use client';

import type { RatingsListPage } from '@pospay/contracts';
import { useInfiniteQuery, type InfiniteData } from '@tanstack/react-query';
import type { RatingsListRange } from '../model/ratings-filters';
import { ratingsKey, readRatingsPage } from './ratings-client';

const pageSize = 20;

/** مؤشر الصفحة التالية مع الشهر اللي سمّته الصفحة اللي طلعته؛ الصفحات اللاحقة بتتبع نفس الشهر. */
interface NextPage {
  cursor: string;
  month: string | null | undefined;
}

/** قراءة القائمة: ما بتشتغلش قبل ما يتعرف الشهر (`range` فارغ). */
export function useRatingsList(
  companyId: string,
  userId: string,
  businessId: string,
  range: RatingsListRange | null,
  employeeId: string,
) {
  const query = { ...range, ...(employeeId ? { employee_id: employeeId } : {}), limit: pageSize };
  return useInfiniteQuery<
    RatingsListPage,
    Error,
    InfiniteData<RatingsListPage>,
    readonly unknown[],
    NextPage | undefined
  >({
    queryKey: [...ratingsKey(companyId, userId, businessId), 'list', query],
    enabled: range !== null,
    initialPageParam: undefined,
    getNextPageParam: (page) =>
      page.next_cursor ? { cursor: page.next_cursor, month: page.month } : undefined,
    queryFn: ({ signal, pageParam }) =>
      readRatingsPage(
        companyId,
        businessId,
        {
          ...query,
          ...(pageParam ? { cursor: pageParam.cursor } : {}),
          ...(pageParam?.month ? { month: pageParam.month } : {}),
        },
        signal,
      ),
    retry: false,
    refetchOnMount: 'always',
    staleTime: 0,
    // كل قراءة ناجحة كائن جديد حتى لو نفس الرد، عشان `useRatingsGate` يفرّق قراءة جديدة عن بيانات قديمة.
    structuralSharing: false,
  });
}
