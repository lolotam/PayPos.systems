import { moneyToString } from '@pospay/domain';
import { SessionError } from './session-error.ts';
import { sessionTotal } from './session-pricing.ts';
import { sessionLineSnapshot } from './session-snapshot.ts';
import { sessionBusinessDate } from './session-time.ts';
import type { SessionRecord } from './session-types.ts';

/** الجسم الكامل بشكل بنيوي؛ الحقول الزائدة تبقى لأن النطاق لا يستورد العقد. */
export interface ChangeLinePerformersResponseFull {
  line: ReturnType<typeof sessionLineSnapshot> & {
    status: 'ACTIVE';
    performers_changed_at: string;
    edited?: true;
  };
  session: { id: string; total_net: string };
}

/** رد من لا تملك قراءة الزيارات: علامة التغيير فقط، من غير أي رقم. */
export interface ChangeLinePerformersResponseNarrow {
  changed: true;
}

/** رد تغيير المنفّذين إما كاملاً أو علامة التغيير فقط، حتى لا يتسرب رقم أو سبب لمن لا تملك قراءة الزيارات. */
export type ChangeLinePerformersResponse =
  ChangeLinePerformersResponseFull | ChangeLinePerformersResponseNarrow;

/**
 * يحسب يوم علامة «اتغيّر المنفّذين» بتوقيت النشاط، لا بمنتصف ليل UTC.
 * اليوم هو ما يراه القارئ في اليومية، والعميل لا يشتقّه من النسخة.
 *
 * @param changedAt وقت التغيير المحقون
 * @param timezone منطقة النشاط المحفوظة
 * @returns التاريخ المدني بصيغة YYYY-MM-DD
 */
export function performersChangedMark(changedAt: Date, timezone: string): string {
  return sessionBusinessDate(changedAt, timezone);
}

/**
 * يسقط أرقام تغيير المنفّذين عمّن لا تملك قراءة الزيارات، بما في ذلك إعادة الإرسال.
 * الجسم الكامل يُحفظ مرة واحدة، والعرض يُحسب في كل رد من صلاحية القراءة الحالية.
 * الرد لا يضيف السبب ولا هوية صاحبة التغيير؛ من بلا قراءة لا ترى حتى لقطة السطر.
 *
 * @param hasBranchRead هل للطالبة قراءة زيارات الفرع
 * @param line لقطة السطر بعد التغيير كما حُفظت
 * @param session معرّف الزيارة وإجمالي الصافي المشتق
 * @returns الجسم الكامل من نفس اللقطة، أو علامة التغيير فقط
 */
export function projectPerformersChangeResponse(
  hasBranchRead: boolean,
  line: ChangeLinePerformersResponseFull['line'],
  session: ChangeLinePerformersResponseFull['session'],
): ChangeLinePerformersResponse {
  if (hasBranchRead) return { line, session };
  return { changed: true };
}

/**
 * يبني جسم تغيير المنفّذين الكامل من الزيارة بعد الحفظ، وإجمالي الأسطر النشطة فقط.
 * السطر الغائب عن الزيارة رفض موحّد، ويوم العلامة يُمرَّر لأن النطاق لا يملك ساعة.
 * حالة السطر في اللقطة هي حالته بعد الحفظ؛ سطر ملغي يعني إن المستدعي بنى الرد قبل الحفظ،
 * فبيرمي خطأ داخلي بدل ما يتحفظ رد نجاح مخالف للعقد ويتعاد إرساله.
 * علامة تعديل السعر تبقى كما هي: تغيير المنفّذين لا يمسّها، فالسطر المعدَّل سعره يبقى معدَّلاً.
 *
 * @param record الزيارة بعد تغيير منفّذات السطر
 * @param lineId هوية السطر المتغيّر
 * @param performersChangedAt يوم العلامة بتوقيت النشاط
 * @param edited هل عُدّل سعر السطر قبل هذا التغيير؛ وجود صف تعديل السعر هو المصدر، لا رقم النسخة
 * @returns لقطة السطر وإجمالي صافي البنود النشطة
 */
export function savedLinePerformersChangeResponse(
  record: SessionRecord,
  lineId: string,
  performersChangedAt: string,
  edited: boolean,
): ChangeLinePerformersResponseFull {
  const line = record.lines.find((item) => item.id === lineId);
  if (line === undefined) throw new SessionError('FORBIDDEN');
  if (line.status !== 'ACTIVE') throw new Error('performers change response built from a line that is not ACTIVE');
  const active = record.lines.filter((item) => item.status === 'ACTIVE').map((item) => item.net);
  return {
    line: {
      ...sessionLineSnapshot(line),
      status: 'ACTIVE',
      performers_changed_at: performersChangedAt,
      ...(edited ? { edited: true as const } : {}),
    },
    session: { id: record.id, total_net: moneyToString(sessionTotal(active)) },
  };
}
