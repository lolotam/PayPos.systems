'use client';

import { useEffect, useState } from 'react';
import { readAccessProof } from '@/shared/api/read-access-proof';

type Read = Parameters<typeof readAccessProof>[0] & { data: unknown; refetch: () => unknown };

/** البيانات اللي كانت مع كل قراءة وقت بداية الرفض: أي بيانات ماسكاها لسه نفس الكائن ما اتقرتش من جديد بعد الرفض. */
interface Seal {
  refused: boolean;
  averages: unknown;
  list: unknown;
}

const unsealed: Seal = { refused: false, averages: undefined, list: undefined };

function readBeforeRefusal(query: Read, sealed: unknown): boolean {
  return readAccessProof(query) === 'granted' && query.data !== undefined && query.data === sealed;
}

/**
 * قاعدة الوصول واحدة للمسارين (المتوسطات والقائمة)، فرفض (401/403) من أي واحد منهم رفض للصفحة كلها: ما يظهرش لا متوسطات ولا
 * تعليقات، حتى لو القراءة التانية لسه ناجحة من قبل الرفض أو فشلت فشل عابر. وبعد ما الرفض يتشال، أي قراءة كانت قبله بتتعاد
 * ولا تظهر إلا بعد قراءة ناجحة جديدة.
 *
 * @param averages حالة استعلام المتوسطات
 * @param list حالة استعلام القائمة
 * @returns `refused` رسالة رفض واحدة، `rereading` بانتظار إعادة قراءة، وإلا `open`
 */
export function useRatingsGate(averages: Read, list: Read): 'open' | 'refused' | 'rereading' {
  const refused = readAccessProof(averages) === 'refused' || readAccessProof(list) === 'refused';
  const [seal, setSeal] = useState<Seal>(unsealed);
  if (refused !== seal.refused)
    setSeal(
      refused
        ? { refused: true, averages: averages.data, list: list.data }
        : { ...seal, refused: false },
    );
  const staleAverages = readBeforeRefusal(averages, seal.averages);
  const staleList = readBeforeRefusal(list, seal.list);
  // إعادة القراءة بتبدأ من جديد (الافتراضي بيلغي الشغالة): قراءة بدأت قبل ما الرفض يتلاحظ ممكن الخادم ردّ عليها بصلاحية قديمة.
  const refetchAverages = averages.refetch;
  const refetchList = list.refetch;
  useEffect(() => {
    if (staleAverages) void refetchAverages();
    if (staleList) void refetchList();
  }, [staleAverages, staleList, refetchAverages, refetchList]);
  if (refused) return 'refused';
  return staleAverages || staleList ? 'rereading' : 'open';
}
