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
 * بيقرر مصير التوقوف المفتوح لموظفة وشهرها بعد إعادة الحساب (FR-046/FR-047):
 * إعادة الحساب الفاشلة ما بتنشرش، فالصف المفتوح بيتعاد استعماله ورمزه بيمشي مع المحرك
 * في الحالتين، وإعادة الحساب الناجحة بتحلّ التوقوف.
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
