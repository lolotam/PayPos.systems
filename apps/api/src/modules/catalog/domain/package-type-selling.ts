/** حالة بيع نوع الباقة: نشط للبيع، أو متوقف مؤقتاً عن البيع. */
export type PackageTypeSellingStatus = 'ACTIVE' | 'STOPPED';

/**
 * لقطة حالة بيع نوع الباقة كما تُقرأ من الصف وتُكتب عليه.
 * وقت الإيقاف هو مصدر الحقيقة للحالة: `null` يعني أن البيع نشط، وغير `null` يعني أنه متوقف.
 */
export interface PackageTypeSellingState {
  /** وقت إيقاف البيع؛ `null` عندما يكون البيع نشطاً. */
  readonly selling_stopped_at: string | null;
  /** نسخة الكتابة التي قرأها العميل. */
  readonly revision: number;
}

/**
 * قرار انتقال بيع نوع الباقة.
 * `change` تغيير مقبول يُكتب على الصف، و`revision-conflict` أن العميل قرأ نسخة أقدم،
 * و`unchanged` أن الحالة المطلوبة مطابقة أصلاً فلا كتابة ولا زيادة في النسخة.
 */
export type PackageTypeSellingDecision =
  | {
      readonly kind: 'change';
      readonly before: PackageTypeSellingState;
      readonly after: PackageTypeSellingState;
    }
  | {
      readonly kind: 'revision-conflict';
      readonly before: PackageTypeSellingState;
    }
  | {
      readonly kind: 'unchanged';
      readonly before: PackageTypeSellingState;
      readonly after: PackageTypeSellingState;
    };

/**
 * يقرر انتقال بيع نوع الباقة بين نشط ومتوقف، بلا قراءة ساعة وبلا أي كتابة.
 * القاعدة: تعارض النسخة يسبق كل ما عداه، فطلب العميل على نسخة قديمة يُرفض حتى لو كانت
 * الحالة المطلوبة مطابقة — وإلا قبلنا تعديلاً على صف تغيّر خلف العميل.
 * وبعده: إن كانت الحالة المطلوبة مطابقة أصلاً فالقرار `unchanged` بلا زيادة في النسخة،
 * وإلا فالتغيير مقبول — تزيد النسخة مرة واحدة فقط، ويوضع وقت الإيقاف المحقون أو يُمسح.
 *
 * @param current الحالة المقروءة للحظتها
 * @param expectedRevision النسخة التي قرأها العميل
 * @param desired الحالة المطلوبة
 * @param at وقت القرار المحقون
 * @returns القرار مع لقطة الحالة قبل وبعد
 */
export function planPackageTypeSelling(
  current: PackageTypeSellingState,
  expectedRevision: number,
  desired: PackageTypeSellingStatus,
  at: Date,
): PackageTypeSellingDecision {
  const before: PackageTypeSellingState = {
    selling_stopped_at: current.selling_stopped_at,
    revision: current.revision,
  };

  // تعارض النسخة أولاً: العميل قرأ نسخة أقدم، فالطلب كله مرفوض حتى لو طابقت الحالة المطلوبة.
  if (expectedRevision !== current.revision) return { kind: 'revision-conflict', before };

  const stopped = current.selling_stopped_at !== null;
  const alreadyInDesiredState = desired === 'STOPPED' ? stopped : !stopped;
  if (alreadyInDesiredState) return { kind: 'unchanged', before, after: { ...before } };

  return {
    kind: 'change',
    before,
    after: {
      selling_stopped_at: desired === 'STOPPED' ? at.toISOString() : null,
      revision: current.revision + 1,
    },
  };
}
