import { assertMoney, sumMoney, type Money } from '@pospay/domain';

import { CommissionCorrectionStepInputError } from './errors.ts';

/** أنواع المصدر التي يقبلها التصحيح؛ نفس أنواع بنود كشف العمولة القابلة للتصحيح. */
export type CommissionCorrectionKind = 'COMMISSION' | 'SALE' | 'TIP_CARD' | 'TIP_CASH';

/**
 * نسبة المصدر المصحَّح: الفرع الذي تم فيه العمل، وتاريخ العمل، وفروع الموظفة في
 * ذلك التاريخ. النسبة تُنسخ من الصف المجمَّد ولا تُشتق من الوضع المباشر أبداً
 * (FR-040)، لأن رابطاً عُدِّل بعد الاعتماد ينقل نسبتها وهي مجمَّدة.
 * الفرع وتاريخ العمل إجباريان: كل صف تصحيح يحمل نسبته كاملة، ومفيش تصحيح
 * ينزل من غير تاريخ عمل معروف؛ الفروع المرفقة بس ممكن تكون فاضية.
 */
export interface CommissionCorrectionAttribution {
  readonly sourceBranchId: string;
  readonly sourceBusinessDate: string;
  readonly attachedBranchIds: readonly string[];
}

/** صف مجمَّد من شهر المصدر: مبلغه ونسبته المنسوخة منه. */
export interface CommissionFrozenSource {
  readonly sourceRef: string;
  readonly kind: CommissionCorrectionKind;
  readonly amount: Money;
  readonly attribution: CommissionCorrectionAttribution;
}

/**
 * تصحيح سبق نشره لنفس المصدر؛ المصدر يتكرر عبر الأجيال فمبالغه تُجمَّع، ونسبته
 * إن وُجدت هي النسبة التي حُلّت من قبل فلا تُعاد حلّها من جديد.
 */
export interface CommissionPostedCorrection {
  readonly sourceRef: string;
  readonly kind: CommissionCorrectionKind;
  readonly amount: Money;
  readonly attribution?: CommissionCorrectionAttribution;
}

/** مصدر أُعيد حسابه من الوضع الحالي: مبلغه الجديد، ونسبته إن لم يكن قد جُمِّد من قبل. */
export interface CommissionRecomputedSource {
  readonly sourceRef: string;
  readonly kind: CommissionCorrectionKind;
  readonly amount: Money;
  readonly attribution?: CommissionCorrectionAttribution;
}

/** مُدخلات خطوة التصحيح: شهر المصدر والموظفة والجيل وهدف التصحيح وثلاث مجموعات المصادر. */
export interface CommissionCorrectionStepInput {
  readonly sourcePeriod: string;
  readonly employeeId: string;
  readonly generation: number;
  readonly targetPeriod: string;
  readonly targetStatementId: string;
  readonly eventId: string;
  readonly frozen: readonly CommissionFrozenSource[];
  readonly posted: readonly CommissionPostedCorrection[];
  readonly recomputed: readonly CommissionRecomputedSource[];
}

/** مسودة صف التصحيح قبل كتابتها: كل ما يحمله صف جدول التصحيح. */
export interface CommissionCorrectionDraft {
  readonly employeeId: string;
  readonly sourcePeriod: string;
  readonly targetPeriod: string;
  readonly targetStatementId: string;
  readonly sourceRef: string;
  readonly kind: CommissionCorrectionKind;
  readonly previousAmount: Money;
  readonly newAmount: Money;
  readonly amount: Money;
  readonly generation: number;
  readonly eventId: string;
  readonly attribution: CommissionCorrectionAttribution;
}

/** المصادر الثلاث مفهرسة بمرجع المصدر؛ كل مصدر في كل مجموعة له مدخل واحد فيها. */
interface SourceBuckets {
  readonly frozen: Map<string, CommissionFrozenSource>;
  readonly posted: Map<string, CommissionPostedCorrection[]>;
  readonly recomputed: Map<string, CommissionRecomputedSource>;
}

/**
 * يسجّل نوع كل مرجع مصدر: المرجع هو هوية المصدر، فلو ظهر بنوعين مختلفين فالمصدر
 * مش مصدر واحد، والتصحيحان هيتبانقوا على نفس مفتاح التخزين.
 *
 * @param kinds     سجل نوع كل مرجع مرئي لحد الآن
 * @param sourceRef مرجع المصدر
 * @param kind      نوع المصدر
 */
function registerKind(
  kinds: Map<string, CommissionCorrectionKind>,
  sourceRef: string,
  kind: CommissionCorrectionKind,
): void {
  const known = kinds.get(sourceRef);
  if (known === undefined) {
    kinds.set(sourceRef, kind);
    return;
  }
  if (known !== kind) {
    throw new CommissionCorrectionStepInputError('SOURCE_KIND_CONFLICT', sourceRef, kind);
  }
}

/**
 * يفهرس الصفوف التي لا يتكرر فيها المصدر؛ فالتكرار معناه أن مدخلين مختلفين يحملان
 * هوية واحدة، فالاختيار يتوقف بدل أن يبني تصحيحاً على أساس غلط.
 *
 * @param rows  الصفوف المراد فهرستها، صف واحد لكل مصدر
 * @param kinds سجل نوع كل مرجع، بيتبنى مع الفهرسة
 * @returns فهرس الصفوف بمرجع المصدر
 */
function indexBySource<T extends { sourceRef: string; kind: CommissionCorrectionKind }>(
  rows: readonly T[],
  kinds: Map<string, CommissionCorrectionKind>,
): Map<string, T> {
  const index = new Map<string, T>();
  for (const row of rows) {
    registerKind(kinds, row.sourceRef, row.kind);
    if (index.has(row.sourceRef)) {
      throw new CommissionCorrectionStepInputError('DUPLICATE_SOURCE', row.sourceRef, row.kind);
    }
    index.set(row.sourceRef, row);
  }
  return index;
}

/**
 * يفهرس التصحيحات المنشورة؛ نفس المصدر يتكرر عبر الأجيال، فالتصحيحات له تُجمَّع
 * ولا تُرفض، لأن مجموعها هو ما حُمِّل على المصدر قبل هذا الجيل.
 *
 * @param rows  التصحيحات المنشورة لنفس الشهر المصدر
 * @param kinds سجل نوع كل مرجع، بيتبنى مع الفهرسة
 * @returns فهرس التصحيحات المنشورة بمرجع المصدر
 */
function indexPosted(
  rows: readonly CommissionPostedCorrection[],
  kinds: Map<string, CommissionCorrectionKind>,
): Map<string, CommissionPostedCorrection[]> {
  const index = new Map<string, CommissionPostedCorrection[]>();
  for (const row of rows) {
    registerKind(kinds, row.sourceRef, row.kind);
    const bucket = index.get(row.sourceRef);
    if (bucket === undefined) index.set(row.sourceRef, [row]);
    else bucket.push(row);
  }
  return index;
}

/**
 * بيتأكد إن المبلغ جوه مدى numeric(14,3)؛ برّه المدى المبلغ مش بيتكتب في
 * الداتابيز أصلاً، فالتصحيح يتوقف بخطأ مُدخَل يحمل مرجع المصدر.
 *
 * @param work     حساب المبلغ اللي ممكن يخرج بحدّ الفلوس
 * @param sourceRef مرجع المصدر المسؤول عن المبلغ
 * @param kind      نوع المصدر
 * @returns المبلغ بعد ما اتأكد من مداه
 */
function withinMoneyRange(
  work: () => Money,
  sourceRef: string,
  kind: CommissionCorrectionKind,
): Money {
  try {
    return work();
  } catch (error) {
    if (error instanceof RangeError) {
      throw new CommissionCorrectionStepInputError('AMOUNT_OUT_OF_RANGE', sourceRef, kind);
    }
    throw error;
  }
}

/**
 * يجيب ما حُمِّل على المصدر قبل هذا التصحيح: ما جُمِّد منه زائد ما نُشر عليه
 * من تصحيحات سابقة؛ والصفر يعني أن المصدر لم يُلمَس بعد.
 *
 * @param buckets  المصادر الثلاث مفهرسة
 * @param sourceRef مرجع المصدر
 * @param kind      نوع المصدر
 * @returns مجموع المبلغ المجمَّد والمبالغ المنشورة
 */
function previousAmount(
  buckets: SourceBuckets,
  sourceRef: string,
  kind: CommissionCorrectionKind,
): Money {
  const amounts: Money[] = [];
  const frozen = buckets.frozen.get(sourceRef);
  if (frozen !== undefined) amounts.push(frozen.amount);
  for (const row of buckets.posted.get(sourceRef) ?? []) amounts.push(row.amount);
  return withinMoneyRange(() => sumMoney(amounts), sourceRef, kind);
}

/**
 * يقرر نسبة المصدر: من الصف المجمَّد إن وُجد، وإلا من تصحيح نُشر من قبل، وإلا
 * من النسبة المحلولة المرفقة بالمصدر المعاد حسابه. المصدر بلا نسبة لا يُنشر له
 * تصحيح، لأن النسبة هي التي توزّع الصف على فروع الموظفة في كشف الرواتب، ولا
 * يجوز أن تتغير بعد اعتماد شهرها. والنسبة الناقصة ما تنفعش، فالفرع وتاريخ العمل
 * إجباريان في كل صف تصحيح.
 *
 * @param buckets  المصادر الثلاث مفهرسة
 * @param sourceRef مرجع المصدر
 * @param kind      نوع المصدر
 * @returns نسبة المصدر المنسوخة
 */
function attributionOf(
  buckets: SourceBuckets,
  sourceRef: string,
  kind: CommissionCorrectionKind,
): CommissionCorrectionAttribution {
  const frozen = buckets.frozen.get(sourceRef);
  const posted = buckets.posted.get(sourceRef) ?? [];
  const recomputed = buckets.recomputed.get(sourceRef);
  const candidates = [
    frozen?.attribution,
    ...posted.map((row) => row.attribution),
    recomputed?.attribution,
  ];
  for (const candidate of candidates) {
    if (candidate === undefined) continue;
    if (candidate.sourceBranchId === '' || candidate.sourceBusinessDate === '') continue;
    return candidate;
  }
  throw new CommissionCorrectionStepInputError('MISSING_ATTRIBUTION', sourceRef, kind);
}

/**
 * يحسب مسودات تصحيح شهر مغلق لموظفة واحدة (FR-039): اتحاد مصادر الشهر المجمَّدة
 * مع المصادر التي سبق تصحيحها مع المصادر التي أُعيد حسابها، ثم فرق كل مصدر بين
 * ما جُمِّد منه زائد ما حُمِّل عليه من تصحيحات سابقة وبين مبلغه المعاد حسابه.
 * الفرق الصفري لا يُنشر، والتصحيح المنشور في جيل جديد يبني على جيله السابق فلا
 * يكرر ما نُشر، والنسبة تُنسخ من الصف المجمَّد لأنها لا تتغيّر بعد الاعتماد.
 * هوية المصدر هي مرجعه لوحده: مرجع واحد بنوعين مختلفين رفض مش مصدرين، وكل
 * مبلغ لازم يكون جوه مدى numeric(14,3) قبل ما المسودة تتبعت. والترتيب بالمصدر
 * عشان ما يعتمدش على ترتيب المُدخلات.
 *
 * @param input شهر المصدر والموظفة والجيل وهدف التصحيح وثلاث مجموعات المصادر
 * @returns مسودات التصحيح مرتبة بالمصدر، وكل مسودة تحمل قبلها وبعدها وفرقها
 */
export function computeCommissionCorrections(
  input: CommissionCorrectionStepInput,
): CommissionCorrectionDraft[] {
  const kinds = new Map<string, CommissionCorrectionKind>();
  const buckets: SourceBuckets = {
    frozen: indexBySource(input.frozen, kinds),
    posted: indexPosted(input.posted, kinds),
    recomputed: indexBySource(input.recomputed, kinds),
  };
  const drafts: CommissionCorrectionDraft[] = [];
  for (const [sourceRef, kind] of kinds) {
    const previous = previousAmount(buckets, sourceRef, kind);
    const next = withinMoneyRange(
      () => assertMoney(buckets.recomputed.get(sourceRef)?.amount ?? 0n),
      sourceRef,
      kind,
    );
    const amount = withinMoneyRange(() => assertMoney(next - previous), sourceRef, kind);
    if (amount === 0n) continue;
    drafts.push({
      employeeId: input.employeeId,
      sourcePeriod: input.sourcePeriod,
      targetPeriod: input.targetPeriod,
      targetStatementId: input.targetStatementId,
      sourceRef,
      kind,
      previousAmount: previous,
      newAmount: next,
      amount,
      generation: input.generation,
      eventId: input.eventId,
      attribution: attributionOf(buckets, sourceRef, kind),
    });
  }
  return drafts.sort((left, right) => {
    if (left.sourceRef === right.sourceRef) return 0;
    return left.sourceRef < right.sourceRef ? -1 : 1;
  });
}
