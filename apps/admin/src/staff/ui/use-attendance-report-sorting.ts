'use client';
import type { SortingState, Updater } from '@tanstack/react-table';
import { useState } from 'react';

const UNSORTED: SortingState = [];

/**
 * حالة الفرز الواحدة التي يقرؤها الجدول ومربع الفرز تحت 600px معًا.
 * تُصفَّر بتغيّر الفرع أو الشهر، كما كان الجدول يُصفَّر بإعادة تركيبه بالمفتاح نفسه.
 */
export function useAttendanceReportSorting(resetKey: string) {
  const [held, setHeld] = useState<{ key: string; sorting: SortingState }>({
    key: resetKey,
    sorting: UNSORTED,
  });
  const sorting = held.key === resetKey ? held.sorting : UNSORTED;
  const onSortingChange = (updater: Updater<SortingState>) =>
    setHeld({ key: resetKey, sorting: typeof updater === 'function' ? updater(sorting) : updater });
  return { sorting, onSortingChange };
}
