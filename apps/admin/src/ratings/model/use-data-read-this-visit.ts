'use client';

import { useState } from 'react';
import { readAccessProof } from '@/shared/api/read-access-proof';

type ReadState = Parameters<typeof readAccessProof>[0] & { data: unknown };

/**
 * يتذكر آخر بيانات اتقرت قراءة ناجحة في الزيارة الحالية. أي بيانات تانية في الكاش (من زيارة سابقة) ما تتعتبرش مقروءة،
 * حتى لو فشلت إعادة قراءتها، لأن `isFetchedAfterMount` بتبقى true بعد الفشل زي النجاح.
 *
 * @param query حالة الاستعلام
 * @returns كائن البيانات اللي اتقرى بنجاح في الزيارة دي، أو undefined لو لسه
 */
export function useDataReadThisVisit(query: ReadState): unknown {
  const [verified, setVerified] = useState<unknown>(undefined);
  if (readAccessProof(query) === 'granted' && query.data !== verified) setVerified(query.data);
  return verified;
}
