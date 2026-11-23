'use client';
import type { SortingState, Updater } from '@tanstack/react-table';
import { useState } from 'react';

const UNSORTED: SortingState = [];

/**
 * حالة الفرز الواحدة التي يقرؤها الجدول ومربع الفرز تحت 600px معًا.
 * عمرها عمر الجدول الظاهر: كلما زال جدول مفتاح الفرع والشهر (تغيّر المفتاح، أو أخفاه رفض)
 * سقط الفرز نهائيًا، كما كان الجدول يُعاد تركيبه من ترتيب المصدر؛ والمفتاح الفارغ يعني لا جدول.
 * التصفير يتم أثناء الرسم نفسه (النمط الموثّق لتخزين ما سبق)، فلا تظهر لقطة بفرز قديم.
 */
export function useAttendanceReportSorting(tableKey: string | null) {
  const [held, setHeld] = useState<{ key: string | null; sorting: SortingState }>({
    key: tableKey,
    sorting: UNSORTED,
  });
  if (held.key !== tableKey) setHeld({ key: tableKey, sorting: UNSORTED });
  const sorting = held.key === tableKey ? held.sorting : UNSORTED;
  const onSortingChange = (updater: Updater<SortingState>) => {
    if (tableKey === null) return;
    setHeld({ key: tableKey, sorting: typeof updater === 'function' ? updater(sorting) : updater });
  };
  return { sorting, onSortingChange };
}
