'use client';

import { useState } from 'react';
import { readAccessProof } from '@/shared/api/read-access-proof';

type AveragesState = Parameters<typeof readAccessProof>[0] & {
  data: { month?: string | null | undefined } | undefined;
};

/**
 * شهر الشاشة: اللي اختاره المستخدم، وإلا الشهر اللي سمّاه الخادم في أول رد ناجح للمتوسطات في الزيارة دي (يتحفظ وقتها).
 * قبل كده null، والقائمة وحقل الشهر ينتظروا.
 *
 * @param averages حالة استعلام المتوسطات المرسَل بلا شهر
 * @param selected الشهر اللي اختاره المستخدم (null لو لسه)
 * @returns الشهر المعروف أو null
 */
export function useRatingsMonth(averages: AveragesState, selected: string | null): string | null {
  const [named, setNamed] = useState<string | null>(null);
  const answered = readAccessProof(averages) === 'granted' ? (averages.data?.month ?? null) : null;
  if (selected === null && answered !== null && answered !== named) setNamed(answered);
  return selected ?? named;
}
