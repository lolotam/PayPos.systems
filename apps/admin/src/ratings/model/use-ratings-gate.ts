'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { readAccessProof } from '@/shared/api/read-access-proof';

type Read = Parameters<typeof readAccessProof>[0] & {
  data: unknown;
  isFetching: boolean;
  refetch: () => unknown;
};

/** القراءات اللي لازم تتبدأ من جديد بعد الإلغاء: كل قراءة كانت بتتقرأ أو معروضة وقت ما الرفض اتلاحظ. */
interface Reread {
  averages: boolean;
  list: boolean;
}

/** البيانات اللي كانت مع كل قراءة وقت بداية الرفض: أي بيانات ماسكاها لسه نفس الكائن ما اتقرتش من جديد بعد الرفض. */
interface Seal {
  refused: boolean;
  averages: unknown;
  list: unknown;
  reread: Reread;
}

const unsealed: Seal = {
  refused: false,
  averages: undefined,
  list: undefined,
  reread: { averages: false, list: false },
};

function readBeforeRefusal(query: Read, sealed: unknown): boolean {
  return readAccessProof(query) === 'granted' && query.data !== undefined && query.data === sealed;
}

/** القراءة اللي اترفضت هي دليل الرفض نفسه فما تتعادش؛ أي تانية معروضة أو شغالة بنعتبرها بدأت قبل الرفض. */
function needsReread(query: Read): boolean {
  const proof = readAccessProof(query);
  return proof === 'granted' || (proof !== 'refused' && query.isFetching);
}

/**
 * قاعدة الوصول واحدة للمسارين (المتوسطات والقائمة)، فرفض (401/403) من أي واحد منهم رفض للصفحة كلها: ما يظهرش لا متوسطات ولا
 * تعليقات، حتى لو القراءة التانية لسه ناجحة من قبل الرفض أو فشلت فشل عابر. وبعد ما الرفض يتشال، أي قراءة كانت قبله بتتعاد
 * ولا تظهر إلا بعد قراءة ناجحة جديدة.
 *
 * لحظة ما الرفض يتلاحظ بنلغي كل القراءات الشغالة في نطاق الصفحة ونبدأها من جديد، حتى القراءة الأولى اللي ما لهاش بيانات
 * لسه: ردّ طلب بدأ قبل الرفض ممكن الخادم قيّمه بنطاق أوسع، ولو سبناه يكمّل كان هيظهر لما الرفض يتشال.
 *
 * @param scope مفتاح نطاق استعلامات الصفحة (`ratingsKey`) لإلغاء قراءاتها
 * @param averages حالة استعلام المتوسطات
 * @param list حالة استعلام القائمة
 * @returns `refused` رسالة رفض واحدة، `rereading` بانتظار إعادة قراءة، وإلا `open`
 */
export function useRatingsGate(
  scope: readonly unknown[],
  averages: Read,
  list: Read,
): 'open' | 'refused' | 'rereading' {
  const queryClient = useQueryClient();
  const refused = readAccessProof(averages) === 'refused' || readAccessProof(list) === 'refused';
  const [seal, setSeal] = useState<Seal>(unsealed);
  if (refused !== seal.refused)
    setSeal(
      refused
        ? {
            refused: true,
            averages: averages.data,
            list: list.data,
            reread: { averages: needsReread(averages), list: needsReread(list) },
          }
        : { ...seal, refused: false },
    );
  const staleAverages = readBeforeRefusal(averages, seal.averages);
  const staleList = readBeforeRefusal(list, seal.list);
  const { refused: sealed, reread } = seal;
  const refetchAverages = averages.refetch;
  const refetchList = list.refetch;
  // الإلغاء بيرجّع القراءة لحالتها قبل الطلب (قراءة أولى بلا بيانات بتفضل واقفة)، وإعادة القراءة بعده بتبدأ طلب جديد بعد الرفض.
  useEffect(() => {
    if (!sealed) return;
    void queryClient.cancelQueries({ queryKey: scope }).then(() => {
      if (reread.averages) void refetchAverages();
      if (reread.list) void refetchList();
    });
  }, [sealed, reread, scope, queryClient, refetchAverages, refetchList]);
  if (refused) return 'refused';
  return staleAverages || staleList ? 'rereading' : 'open';
}
