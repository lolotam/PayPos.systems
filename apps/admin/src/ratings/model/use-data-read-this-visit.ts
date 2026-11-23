'use client';

import { useState } from 'react';
import { readAccessProof } from '@/shared/api/read-access-proof';

type ReadState = Parameters<typeof readAccessProof>[0] & { data: unknown };

/**
 * يتذكر آخر بيانات اتقرت قراءة ناجحة في الزيارة الحالية. أي بيانات تانية في الكاش (من زيارة سابقة) ما تتعتبرش مقروءة،
 * حتى لو فشلت إعادة قراءتها، لأن `isFetchedAfterMount` بتبقى true بعد الفشل زي النجاح. والرفض (401/403) بيمسح اللي اتحفظ،
 * فأي فشل بعده (500 أو شبكة) ما يرجّعش التعليقات القديمة؛ ما يظهروش تاني إلا بعد قراءة ناجحة جديدة.
 *
 * @param query حالة الاستعلام
 * @returns كائن البيانات اللي اتقرى بنجاح في الزيارة دي، أو undefined لو لسه
 */
export function useDataReadThisVisit(query: ReadState): unknown {
  const [verified, setVerified] = useState<unknown>(undefined);
  const proof = readAccessProof(query);
  if (proof === 'refused' && verified !== undefined) setVerified(undefined);
  else if (proof === 'granted' && query.data !== verified) setVerified(query.data);
  return verified;
}
