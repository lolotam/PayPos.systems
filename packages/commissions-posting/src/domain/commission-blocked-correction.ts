/**
 * رمز التوقف: الشهر المغلق ما لقاش خطة سارية (NO_PLAN) أو مفيش مرتب يسعّر بيه (NO_SALARY)،
 * والرمزين هم الحالتان الوحيدتان اللي الجدول والقاعدة بيسموحا بهم (FR-046).
 */
export type CommissionBlockCode = 'NO_PLAN' | 'NO_SALARY';

/** الصف المفتوح الوحيد لتوقيف موظفة في شهر مغلق: هويته ورمزه وقت القراءة. */
export interface CommissionOpenBlock {
  readonly id: string;
  readonly code: CommissionBlockCode;
}

/**
 * قرار خطوة التوقف بعد إعادة حساب شهر موظفة: ما فيش صف ولا فيش فشل (NONE)،
 * أو حل الصف المفتوح (RESOLVE)، أو تسجيل صف جديد بالرمز (RECORD)،
 * أو تبديل رمز الصف المفتوح (UPDATE_CODE)، أو إبقاء الصف بلا كتابة (KEEP).
 */
export type CommissionBlockDecision =
  | { readonly kind: 'NONE' }
  | { readonly kind: 'RESOLVE'; readonly blockId: string }
  | { readonly kind: 'RECORD'; readonly code: CommissionBlockCode }
  | { readonly kind: 'UPDATE_CODE'; readonly blockId: string; readonly code: CommissionBlockCode }
  | { readonly kind: 'KEEP'; readonly blockId: string };

/**
 * الحساب الفاشل بيرجع قرار كتابة على التوقف: تسجيل أو تبديل رمز أو إبقاء.
 *
 * @param open           الصف المفتوح الحالي، أو null لو مفيش
 * @param recompute      نتيجة إعادة الحساب الفاشلة
 * @param recompute.ok   دائماً false في الشكل ده
 * @param recompute.code رمز الرفض من المحرك (NO_PLAN أو NO_SALARY)
 */
export function decideCommissionBlock(
  open: CommissionOpenBlock | null,
  recompute: { readonly ok: false; readonly code: CommissionBlockCode },
): Extract<CommissionBlockDecision, { kind: 'RECORD' | 'UPDATE_CODE' | 'KEEP' }>;
/**
 * الحساب الناجح بيرجع ولا كتابة أو حلّ الصف المفتوح.
 *
 * @param open         الصف المفتوح الحالي، أو null لو مفيش
 * @param recompute    نتيجة إعادة الحساب الناجحة
 * @param recompute.ok دائماً true في الشكل ده
 */
export function decideCommissionBlock(
  open: CommissionOpenBlock | null,
  recompute: { readonly ok: true },
): Extract<CommissionBlockDecision, { kind: 'NONE' | 'RESOLVE' }>;
/**
 * بيقرر مصير التوقف المفتوح لموظفة وشهرها بعد إعادة الحساب (FR-046/FR-047):
 * إعادة الحساب الفاشلة ما بتنشرش، فالصف المفتوح بيتعاد استعماله ورمزه بيمشي مع المحرك
 * في الحالتين، وإعادة الحساب الناجحة بتحلّ التوقف. الأنماط المحمولة بتربط شكل القرار
 * بشكل النتيجة: فشل يرجع تسجيلاً أو تبديلاً أو إبقاء، ونجاح يرجع ولا شيء أو حلاً.
 *
 * @param open      الصف المفتوح الحالي للموظفة في الشهر، أو null لو مفيش
 * @param recompute نتيجة إعادة الحساب: نجحت، أو سبب رفضها
 * @returns القرار اللي الخطوة بتنفذه: ولا كتابة، أو حل، أو تسجيل، أو تبديل رمز، أو إبقاء
 */
export function decideCommissionBlock(
  open: CommissionOpenBlock | null,
  recompute: { readonly ok: true } | { readonly ok: false; readonly code: CommissionBlockCode },
): CommissionBlockDecision {
  if (recompute.ok) {
    return open === null ? { kind: 'NONE' } : { kind: 'RESOLVE', blockId: open.id };
  }
  if (open === null) return { kind: 'RECORD', code: recompute.code };
  return open.code === recompute.code
    ? { kind: 'KEEP', blockId: open.id }
    : { kind: 'UPDATE_CODE', blockId: open.id, code: recompute.code };
}
