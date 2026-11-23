'use client';

import { type Dispatch, type SetStateAction, useState } from 'react';
import { nextRatingsEpoch } from '@/ratings/api/ratings-client';
import { readAccessProof } from '@/shared/api/read-access-proof';

type Read = Parameters<typeof readAccessProof>[0] & {
  data: unknown;
  isFetching: boolean;
  errorUpdateCount: number;
  errorUpdatedAt: number;
};

/** جيل كل قراءة: جزء من مفتاح الاستعلام، فزيادته بتبدأ قراءة جديدة تمامًا بلا أي بيانات أو طلب شغال من القديمة. */
export interface RatingsEpochs {
  averages: number;
  list: number;
}

export const firstEpochs: RatingsEpochs = { averages: 0, list: 0 };

/** ما تحفظه البوابة عن قراءة واحدة. */
interface ReadSeal {
  /** علامة آخر رفض اتلاحظ للقراءة دي؛ بتتغير مع كل رفض جديد حتى لو الصفحة مرفوضة أصلًا. */
  mark: string | null;
  /** القراءة اتبدلت بعد رفض وكانت ماسكة بيانات: الصفحة بتستنى قراءتها الجديدة ولا تعرض حاجة قبلها. */
  owed: boolean;
}

interface Seal {
  averages: ReadSeal;
  list: ReadSeal;
}

const unsealed: Seal = {
  averages: { mark: null, owed: false },
  list: { mark: null, owed: false },
};

/** علامة الرفض: رقم الجيل مع عدّاد وتوقيت آخر خطأ، فكل 401/403 جديد له علامة جديدة وعودة الحالة بالإلغاء لنفس العلامة مش رفض جديد. */
function denialMark(query: Read, epoch: number): string | null {
  return readAccessProof(query) === 'refused'
    ? `${epoch}:${query.errorUpdateCount}:${query.errorUpdatedAt}`
    : null;
}

/** كل قراءة ماسكة بيانات أو شغالة بتتبدل، إلا قراءة مرفوضة واقفة: هي دليل الرفض نفسه وأي نجاح ليها طلب جديد أصلًا. */
function mustRestart(query: Read): boolean {
  const idleDenial = readAccessProof(query) === 'refused' && !query.isFetching;
  return !idleDenial && (query.data !== undefined || query.isFetching);
}

function sealRead(prev: ReadSeal, query: Read, mark: string | null, restart: boolean): ReadSeal {
  const waiting = readAccessProof(query) === 'pending' && query.isFetching;
  return {
    mark: mark ?? prev.mark,
    owed: restart ? query.data !== undefined : prev.owed && waiting,
  };
}

const isNew = (mark: string | null, seen: string | null) => mark !== null && mark !== seen;

const sameRead = (a: ReadSeal, b: ReadSeal) => a.mark === b.mark && a.owed === b.owed;

/**
 * قاعدة الوصول واحدة للمسارين (المتوسطات والقائمة)، فرفض (401/403) من أي واحد منهم رفض للصفحة كلها: رسالة رفض واحدة، وما
 * يظهرش لا متوسطات ولا تعليقات، حتى لو القراءة التانية لسه ناجحة من قبل الرفض أو فشلت فشل عابر.
 *
 * القاعدة: بعد أي رفض يتلاحظ، ما يظهرش أي حاجة اتطلبت قبله. يعني لا صفحات قديمة (حتى لو الصفحة التالية فشلت أو كانت شغالة)،
 * ولا قراءة أولى أو صفحة تالية أو إعادة محاولة كانت شغالة، ولا قراءة خلصت بين الرسم والتأثير. وكل رفض جديد بيجدّد الحاجز حتى لو
 * الصفحة مرفوضة أصلًا، لأن علامة كل قراءة بتتغير مع كل رفض مش مع تحوّل الصفحة من مفتوحة لمرفوضة.
 *
 * التنفيذ بإسقاط الحالة مش بتتبع الكائنات: لحظة ما الرفض يتلاحظ، وفي نفس الرسم قبل ما يتعرض، بنزوّد جيل كل قراءة ماسكة بيانات
 * أو شغالة، فمفتاحها بيتغير وتبدأ قراءة جديدة من أول صفحة، والمفتاح القديم ما حدش بيراقبه فأي رد ليه يقع في كاش ما بيتعرضش.
 * مفيش تأثير جانبي متأخر، فمفيش لحظة بين الملاحظة والتنفيذ. القراءة المرفوضة الواقفة هي الوحيدة اللي بتتساب: هي دليل الرفض،
 * وأي نجاح ليها بعد كده طلب جديد أصلًا. وبعد ما الرفض يتشال، القراءة اللي كانت ماسكة بيانات بتفضل `rereading` لحد ما
 * قراءتها الجديدة تخلص.
 *
 * @param averages حالة استعلام المتوسطات
 * @param list حالة استعلام القائمة
 * @param epochs جيل القراءتين الحالي (حالة الصفحة، لأنه جزء من مفتاحي الاستعلامين)
 * @param setEpochs تعديل الأجيال لما رفض جديد يتلاحظ
 * @returns `refused` رسالة رفض واحدة، `rereading` بانتظار قراءة جديدة لبيانات اتشالت، وإلا `open`
 */
export function useRatingsGate(
  averages: Read,
  list: Read,
  epochs: RatingsEpochs,
  setEpochs: Dispatch<SetStateAction<RatingsEpochs>>,
): 'open' | 'refused' | 'rereading' {
  const [seal, setSeal] = useState<Seal>(unsealed);
  const averagesMark = denialMark(averages, epochs.averages);
  const listMark = denialMark(list, epochs.list);
  const denied = isNew(averagesMark, seal.averages.mark) || isNew(listMark, seal.list.mark);
  const restartAverages = denied && mustRestart(averages);
  const restartList = denied && mustRestart(list);
  const next: Seal = {
    averages: sealRead(seal.averages, averages, averagesMark, restartAverages),
    list: sealRead(seal.list, list, listMark, restartList),
  };
  if (!sameRead(seal.averages, next.averages) || !sameRead(seal.list, next.list)) setSeal(next);
  if (restartAverages || restartList)
    setEpochs({
      averages: restartAverages ? nextRatingsEpoch() : epochs.averages,
      list: restartList ? nextRatingsEpoch() : epochs.list,
    });
  if (readAccessProof(averages) === 'refused' || readAccessProof(list) === 'refused')
    return 'refused';
  return next.averages.owed || next.list.owed ? 'rereading' : 'open';
}
