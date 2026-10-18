import { moneyToString } from '@pospay/domain';
import { SessionError } from './session-error.ts';
import { sessionTotal } from './session-pricing.ts';
import { sessionLineSnapshot } from './session-snapshot.ts';
import type { SessionRecord } from './session-types.ts';

/** الجسم الكامل بشكل بنيوي؛ الحقول الزائدة تبقى لأن النطاق لا يستورد العقد. */
export interface CancelServiceLineResponseFull {
  line: ReturnType<typeof sessionLineSnapshot> & { status: 'CANCELLED'; cancelled_at: string };
  session: { id: string; total_net: string };
}

/** رد من لا تملك قراءة الزيارات: علامة الإلغاء فقط، من غير أي رقم. */
export interface CancelServiceLineResponseNarrow {
  cancelled: true;
}

/** رد الإلغاء إما كاملاً أو علامة الإلغاء فقط، حتى لا يتسرب رقم أو سبب لمن لا تملك قراءة الزيارات. */
export type CancelServiceLineResponse =
  CancelServiceLineResponseFull | CancelServiceLineResponseNarrow;

/**
 * يسقط أرقام الإلغاء عمّن لا تملك قراءة الزيارات، بما في ذلك إعادة الإرسال.
 * الجسم الكامل يُحفظ مرة واحدة، والعرض يُحسب في كل رد من صلاحية القراءة الحالية.
 * الرد لا يضيف السبب ولا هوية الملغية؛ من بلا قراءة لا ترى حتى لقطة السطر.
 *
 * @param hasBranchRead هل للطالبة قراءة زيارات الفرع
 * @param line لقطة السطر الملغى كما حُفظت
 * @param session معرّف الزيارة وإجمالي الصافي المشتق
 * @returns الجسم الكامل من نفس اللقطة، أو علامة الإلغاء فقط
 */
export function projectCancelResponse(
  hasBranchRead: boolean,
  line: CancelServiceLineResponseFull['line'],
  session: CancelServiceLineResponseFull['session'],
): CancelServiceLineResponse {
  if (hasBranchRead) return { line, session };
  return { cancelled: true };
}

/**
 * يبني جسم الإلغاء الكامل من الزيارة بعد الحفظ، وإجمالي الأسطر النشطة فقط.
 * السطر الغائب عن الزيارة رفض موحّد، ووقت الإلغاء يُمرَّر لأن النطاق لا يملك ساعة.
 * حالة السطر في اللقطة هي حالته بعد الحفظ؛ سطر لسه ACTIVE يعني إن المستدعي بنى الرد قبل الحفظ،
 * فبيرمي خطأ داخلي بدل ما يتحفظ رد نجاح مخالف للعقد ويتعاد إرساله.
 *
 * @param record الزيارة بعد تغيير حالة السطر
 * @param lineId هوية السطر الملغى
 * @param cancelledAt وقت الإلغاء المحقون
 * @returns لقطة السطر وإجمالي صافي البنود النشطة
 */
export function savedLineCancelResponse(
  record: SessionRecord,
  lineId: string,
  cancelledAt: Date,
): CancelServiceLineResponseFull {
  const line = record.lines.find((item) => item.id === lineId);
  if (line === undefined) throw new SessionError('FORBIDDEN');
  if (line.status !== 'CANCELLED') throw new Error('cancel response built from a line that is not CANCELLED');
  const active = record.lines.filter((item) => item.status === 'ACTIVE').map((item) => item.net);
  return {
    line: { ...sessionLineSnapshot(line), status: 'CANCELLED', cancelled_at: cancelledAt.toISOString() },
    session: { id: record.id, total_net: moneyToString(sessionTotal(active)) },
  };
}
