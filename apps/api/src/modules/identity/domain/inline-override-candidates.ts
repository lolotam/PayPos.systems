import type { ScopeType } from './access.ts';
import type { OverrideTerms } from './permission-edit.ts';

/**
 * يرتّب العضويات المرشحة لكتابة استثناء صلاحية (080-b): العضوية اللي نطاقها يطابق نطاق
 * الاستثناء أول، بعدين العضوية الأساسية، وبعدها الباقي بالترتيب الأصلي. أول تطابق هو اللي
 * بيتقبل، فالترتيب ده هو اللي بيحدد أين ينزل الاستثناء وما يتنقلش لتغطية فرع ما طلبوش.
 *
 * المطابقة على نوع النطاق ومعرّفه، ومعرّف النطاق بيتقارن من غير حساسية حالة الأحرف عشان
 * UUID المكتوب بحرف كبير والكتير بحرف صغير يبقوا نفس النطاق.
 *
 * @param memberships العضويات المرشحة — الأساسية أولاً
 * @param terms      نطاق الاستثناء المطلوب كتابته
 * @returns ترتيب العضويات المرشحة أول مطابقة فيها
 */
export function orderOverrideCandidateMemberships<
  T extends { readonly scopeType: ScopeType; readonly scopeId: string },
>(memberships: readonly T[], terms: Pick<OverrideTerms, 'scope_type' | 'scope_id'>): T[] {
  const scopeId = terms.scope_id.toLowerCase();
  const matching = memberships.filter(
    (membership) =>
      membership.scopeType === terms.scope_type && membership.scopeId.toLowerCase() === scopeId,
  );
  const primary = memberships[0];
  const rest = memberships.filter(
    (membership) => !matching.includes(membership) && membership !== primary,
  );
  return [
    ...matching,
    ...(primary !== undefined && !matching.includes(primary) ? [primary] : []),
    ...rest,
  ];
}

/** بيانات استثناء مرشّح للنقل عند تغيير الفرع الأساسي للموظفة (080-b). */
export interface OverrideBranchMoveCandidate {
  /** مصدر العضوية: الأساسية القديمة أو الفرع الإضافي المدمج. */
  readonly source: 'old_primary' | 'merged_extra';
  /** أثر الاستثناء. */
  readonly effect: 'ALLOW' | 'DENY';
  /** نوع نطاق الاستثناء. */
  readonly scopeType: ScopeType;
  /** كود الصلاحية. */
  readonly permissionCode: string;
  /** نهاية المدة أو null. */
  readonly expiresAt: Date | null;
}

/**
 * يقرر هل ينتقل استثناء الصلاحية للعضوية الأساسية الجديدة عند نقل الفرع الأساسي:
 * - المنتهي مدته لا ينتقل أبداً (`expiresAt !== null && expiresAt <= at`).
 * - من العضوية الأساسية القديمة: ينتقل المنع (`DENY`) على نطاق الشركة أو النشاط فقط،
 *   بينما استثناءات الفرع تبقى على العضوية القديمة وتنتهي معها (AC-F3-3).
 * - من عضوية الفرع الإضافي المدمج: ينتقل المنع دائماً، والسماح ينتقل بس لو صلاحية
 *   الدور الجديد تسمح بيه.
 *
 * @param candidate           الاستثناء المرشح ومصدر عضويته
 * @param allowedPermissions  الصلاحيات المسموح بها لدور العضوية الجديدة
 * @param at                  لحظة التنفيذ المعتمدة
 * @returns true لو يجب نقل الاستثناء للعضوية الجديدة
 */
export function shouldTransferOverrideOnBranchMove(
  candidate: OverrideBranchMoveCandidate,
  allowedPermissions: readonly string[],
  at: Date,
): boolean {
  if (candidate.expiresAt !== null && candidate.expiresAt <= at) return false;
  if (candidate.source === 'old_primary') {
    return (
      candidate.effect === 'DENY' &&
      (candidate.scopeType === 'COMPANY' || candidate.scopeType === 'BUSINESS')
    );
  }
  return candidate.effect === 'DENY' || allowedPermissions.includes(candidate.permissionCode);
}
