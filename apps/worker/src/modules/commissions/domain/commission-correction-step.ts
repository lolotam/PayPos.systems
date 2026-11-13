import { sumMoney, type Money } from '@pospay/domain';

import { CommissionCorrectionStepInputError } from './errors.ts';

/** أنواع المصدر التي يجرؤ التصحيح؛ نفس أنواع بنود كشف العمولة القابلة للتصحيح. */
export type CommissionCorrectionKind = 'COMMISSION' | 'SALE' | 'TIP_CARD' | 'TIP_CASH';

/**
 * نسبة المصدر المصحَّح: الفرع الذي تم فيه العمل، وتاريخ العمل، وفروع الموظفة في
 * ذلك التاريخ. النسبة تُنسخ من الصف المجمَّد ولا تُشتق من الوضع المباشر أبداً
 * (FR-040)، لأن رابطاً عُدِّل بعد الاعتماد ينقل لولاها ما كان مجمَّداً.
 */
export interface CommissionCorrectionAttribution {
  readonly sourceBranchId: string | null;
  readonly sourceBusinessDate: string | null;
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

/** هوية المصدر داخل الخطوة: مرجعه ونوعه، لأن المرجع نفسه بنوعين مصدران مختلفان. */
interface SourceIdentity {
  readonly key: string;
  readonly sourceRef: string;
  readonly kind: CommissionCorrectionKind;
}

/** المصادر الثلاث مفهرسة بمفتاح المصدر؛ كل مصدر في كل مجموعة له مدخل واحد فيها. */
interface SourceBuckets {
  readonly frozen: Map<string, CommissionFrozenSource>;
  readonly posted: Map<string, CommissionPostedCorrection[]>;
  readonly recomputed: Map<string, CommissionRecomputedSource>;
}

/**
 * يبني مفتاح المصدر من مرجعه ونوعه؛ المفتاح نص مُرمَّز لا يلتصق فيه المرجع
 * بنوعه ولا مرجعان مختلفان، لأن المصدر الواحد لا يُقاس مرتين ولا يُنشر له
 * تصحيحان في نفس الوقت.
 *
 * @param sourceRef مرجع المصدر كما ورد في الصف المجمَّد
 * @param kind نوع المصدر
 * @returns مفتاح نصي يميّز المصدر عن غيره
 */
function sourceKey(sourceRef: string, kind: CommissionCorrectionKind): string {
  return JSON.stringify([sourceRef, kind]);
}

/**
 * يفهرس الصفوف التي لا يتكرر فيها المصدر؛ فالتكرار معناه أن مدخلين مختلفين يحملان
 * هوية واحدة، فالاختيار يتوقف بدل أن يبني تصحيحاً على أساس غلط.
 *
 * @param rows الصفوف المراد فهرستها، صف واحد لكل مصدر
 * @returns فهرس الصفوف بمفتاح المصدر
 */
function indexBySource<T extends { sourceRef: string; kind: CommissionCorrectionKind }>(
  rows: readonly T[],
): Map<string, T> {
  const index = new Map<string, T>();
  for (const row of rows) {
    const key = sourceKey(row.sourceRef, row.kind);
    if (index.has(key)) {
      throw new CommissionCorrectionStepInputError('DUPLICATE_SOURCE', row.sourceRef, row.kind);
    }
    index.set(key, row);
  }
  return index;
}

/**
 * يفهرس التصحيحات المنشورة؛ نفس المصدر يتكرر عبر الأجيال، فالتصحيحات له تُجمَّع
 * ولا تُرفض، لأن مجموعها هو ما حُمِّل على المصدر قبل هذا الجيل.
 *
 * @param rows التصحيحات المنشورة لنفس الشهر المصدر
 * @returns فهرس التصحيحات المنشورة بمفتاح المصدر
 */
function indexPosted(
  rows: readonly CommissionPostedCorrection[],
): Map<string, CommissionPostedCorrection[]> {
  const index = new Map<string, CommissionPostedCorrection[]>();
  for (const row of rows) {
    const key = sourceKey(row.sourceRef, row.kind);
    const bucket = index.get(key);
    if (bucket === undefined) index.set(key, [row]);
    else bucket.push(row);
  }
  return index;
}

/**
 * يجمع هوية كل مصدر ظهر في أي من المجموعات الثلاث؛ المصدر ينتمي للمجموعة حتى لو
 * غاب منها، لأن غيابه هو نفسه معلومة: غاب عن إعادة الحساب فمبلغه الجديد صفر.
 *
 * @param buckets المصادر الثلاث مفهرسة
 * @returns هوية كل مصدر مرة واحدة
 */
function unionOfSources(buckets: SourceBuckets): SourceIdentity[] {
  const identities = new Map<string, SourceIdentity>();
  const remember = (sourceRef: string, kind: CommissionCorrectionKind): void => {
    const key = sourceKey(sourceRef, kind);
    if (!identities.has(key)) identities.set(key, { key, sourceRef, kind });
  };
  for (const row of buckets.frozen.values()) remember(row.sourceRef, row.kind);
  for (const rows of buckets.posted.values()) {
    for (const row of rows) remember(row.sourceRef, row.kind);
  }
  for (const row of buckets.recomputed.values()) remember(row.sourceRef, row.kind);
  return [...identities.values()];
}

/**
 * يجيب ما حُمِّل على المصدر قبل هذا التصحيح: ما جُمِّد منه زائد ما نُشر عليه
 * من تصحيحات سابقة؛ والصفر يعني أن المصدر لم يُلمَس بعد.
 *
 * @param buckets المصادر الثلاث مفهرسة
 * @param key مفتاح المصدر
 * @returns مجموع المبلغ المجمَّد والمبالغ المنشورة
 */
function previousAmount(buckets: SourceBuckets, key: string): Money {
  const amounts: Money[] = [];
  const frozen = buckets.frozen.get(key);
  if (frozen !== undefined) amounts.push(frozen.amount);
  for (const row of buckets.posted.get(key) ?? []) amounts.push(row.amount);
  return sumMoney(amounts);
}

/**
 * يقرر نسبة المصدر: من الصف المجمَّد إن وُجد، وإلا من تصحيح نُشر من قبل، وإلا
 * من النسبة المحلولة المرفقة بالمصدر المعاد حسابه. المصدر بلا نسبة لا يُنشر له
 * تصحيح، لأن النسبة هي التي توزّع الصف على فروع الموظفة في كشف الرواتب، ولا
 * يجوز أن تتغير بعد اعتماد شهرها.
 *
 * @param identity هوية المصدر
 * @param buckets المصادر الثلاث مفهرسة
 * @returns نسبة المصدر المنسوخة
 */
function attributionOf(
  identity: SourceIdentity,
  buckets: SourceBuckets,
): CommissionCorrectionAttribution {
  const frozen = buckets.frozen.get(identity.key);
  if (frozen !== undefined) return frozen.attribution;
  for (const row of buckets.posted.get(identity.key) ?? []) {
    if (row.attribution !== undefined) return row.attribution;
  }
  const recomputed = buckets.recomputed.get(identity.key);
  if (recomputed?.attribution !== undefined) return recomputed.attribution;
  throw new CommissionCorrectionStepInputError(
    'MISSING_ATTRIBUTION',
    identity.sourceRef,
    identity.kind,
  );
}

/**
 * يبني مسودة التصحيح من فرق المصدر؛ المسودة تحمل ما قبله وما بعده والفرق بينهما،
 * والجيل واسم الحدث والشهرين ومعرف كشف الهدف.
 *
 * @param input مُدخلات خطوة التصحيح
 * @param identity هوية المصدر
 * @param buckets المصادر الثلاث مفهرسة
 * @param previous المبلغ المحمَّل على المصدر
 * @param next المبلغ المعاد حسابه
 * @param amount الفرق بين الجديد والقديم
 * @returns مسودة صف التصحيح
 */
function buildDraft(
  input: CommissionCorrectionStepInput,
  identity: SourceIdentity,
  buckets: SourceBuckets,
  previous: Money,
  next: Money,
  amount: Money,
): CommissionCorrectionDraft {
  return {
    employeeId: input.employeeId,
    sourcePeriod: input.sourcePeriod,
    targetPeriod: input.targetPeriod,
    targetStatementId: input.targetStatementId,
    sourceRef: identity.sourceRef,
    kind: identity.kind,
    previousAmount: previous,
    newAmount: next,
    amount,
    generation: input.generation,
    eventId: input.eventId,
    attribution: attributionOf(identity, buckets),
  };
}

/**
 * يرتّب المسودات بالمصدر ثم بنوعه؛ الترتيب ثابت فلا يعتمد على ترتيب المُدخلات.
 *
 * @param left المسودة الأولى
 * @param right المسودة الثانية
 * @returns رقم المقارنة
 */
function bySourceOrder(left: CommissionCorrectionDraft, right: CommissionCorrectionDraft): number {
  if (left.sourceRef !== right.sourceRef) return left.sourceRef < right.sourceRef ? -1 : 1;
  if (left.kind !== right.kind) return left.kind < right.kind ? -1 : 1;
  return 0;
}

/**
 * يحسب مسودات تصحيح شهر مغلق لموظفة واحدة (FR-039): اتحاد مصادر الشهر المجمَّدة
 * مع المصادر التي سبق تصحيحها مع المصادر التي أُعيد حسابها، ثم فرق كل مصدر بين
 * ما جُمِّد منه زائد ما حُمِّل عليه من تصحيحات سابقة وبين مبلغه المعاد حسابه.
 * الفرق الصفري لا يُنشر، والتصحيح المنشور في جيل جديد يبني على جيله السابق فلا
 * يكرر ما نُشر، والنسبة تُنسخ من الصف المجمَّد لأنها لا تتغيّر بعد الاعتماد.
 *
 * @param input شهر المصدر والموظفة والجيل وهدف التصحيح وثلاث مجموعات المصادر
 * @returns مسودات التصحيح مرتبة بالمصدر ونوعه، وكل مسودة تحمل قبلها وبعدها وفرقها
 */
export function computeCommissionCorrections(
  input: CommissionCorrectionStepInput,
): CommissionCorrectionDraft[] {
  const buckets: SourceBuckets = {
    frozen: indexBySource(input.frozen),
    posted: indexPosted(input.posted),
    recomputed: indexBySource(input.recomputed),
  };
  const drafts: CommissionCorrectionDraft[] = [];
  for (const identity of unionOfSources(buckets)) {
    const previous = previousAmount(buckets, identity.key);
    const next = buckets.recomputed.get(identity.key)?.amount ?? 0n;
    const amount = next - previous;
    if (amount === 0n) continue;
    drafts.push(buildDraft(input, identity, buckets, previous, next, amount));
  }
  return drafts.sort(bySourceOrder);
}
