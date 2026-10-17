import { moneyToString } from '@pospay/domain';
import { SessionError } from './session-error.ts';
import { sessionTotal } from './session-pricing.ts';
import { sessionLineSnapshot } from './session-snapshot.ts';
import type { SessionRecord } from './session-types.ts';

/** الجسم الكامل بشكل بنيوي؛ الحقول الزائدة تبقى لأن النطاق لا يستورد العقد. */
export interface EditServiceLineResponseFull {
  line: { edited: true };
  session: { id: string; total_net: string };
}

/** رد من لا تملك قراءة الزيارات: علامة الحفظ فقط، من غير أي رقم. */
export interface EditServiceLineResponseNarrow {
  saved: true;
  edited: true;
}

/** رد التعديل إما كاملاً أو علامة الحفظ فقط؛ لا ثالث لهما، حتى لا يتسرب رقم لمن لا تملك قراءة الزيارات (ED-Q14). */
export type EditServiceLineResponse = EditServiceLineResponseFull | EditServiceLineResponseNarrow;

/**
 * يسقط أرقام التعديل عمّن لا تملك قراءة الزيارات، بما في ذلك إعادة الإرسال.
 * الجسم الكامل يُحفظ مرة واحدة، والعرض يُحسب في كل رد من صلاحية القراءة الحالية.
 *
 * @param full جسم التعديل الكامل
 * @param canRead هل للطالبة قراءة زيارات الفرع
 * @returns الجسم الكامل كما هو، أو علامة الحفظ فقط
 */
export function projectEditResponse<T extends EditServiceLineResponseFull>(
  full: T,
  canRead: boolean,
): T | EditServiceLineResponseNarrow {
  if (canRead) return full;
  return { saved: true, edited: true };
}

/**
 * يبني جسم التعديل الكامل من الزيارة المحفوظة، وإجمالي النشط فقط.
 * السطر الغائب عن الزيارة رفض موحّد، وعلامة edited تُضاف فوق لقطة العرض.
 *
 * @param record الزيارة بعد حفظ التعديل
 * @param lineId هوية السطر المعدّل
 * @returns السطر المحدّث وإجمالي صافي البنود النشطة
 */
export function savedLineEditResponse(record: SessionRecord, lineId: string) {
  const line = record.lines.find((item) => item.id === lineId);
  if (line === undefined) throw new SessionError('FORBIDDEN');
  const active = record.lines.filter((item) => item.status === 'ACTIVE').map((item) => item.net);
  return {
    line: { ...sessionLineSnapshot(line), edited: true as const },
    session: { id: record.id, total_net: moneyToString(sessionTotal(active)) },
  };
}
