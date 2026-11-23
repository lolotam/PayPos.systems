import type { ScopeType } from './access.ts';
import { RATINGS_READ_ROLES } from './ratings-read-eligibility.ts';

/** عضوية سارية للمستخدم: معرّفها ونطاقها وكود دورها النظامي، أو null لدور مخصص من الشركة. */
export interface RatingsReadMembership {
  readonly membershipId: string;
  readonly scopeType: ScopeType;
  readonly scopeId: string;
  readonly systemRoleCode: string | null;
}

/**
 * منحة `read:ratings:branch` واحدة معروف مصدرها: من دور العضوية أو من override عليها، ولكلٍّ نطاقها الخاص.
 * الصلاحية مش بتتخزن هنا لأن القاعدة كلها على هذا الكود بالذات.
 */
export interface RatingsReadGrant {
  readonly membershipId: string;
  readonly effect: 'ALLOW' | 'DENY';
  readonly scopeType: ScopeType;
  readonly scopeId: string;
}

/** الشركة والنشاط المطلوب قراءة تقييماتهم. */
export interface RatingsReadScope {
  readonly companyId: string;
  readonly businessId: string;
}

/**
 * بيحدد فروع النشاط اللي المستخدم يقدر يقرأ تقييماتها الآن (FR-B15) بنفس قاعدة الجرس في الـ worker (BR-B4، RT-Q7b).
 * الفرع مسموح بس لو عضوية مدير واحدة بدورها النظامي الحالي (أحد الأربعة) تغطي الفرع وتحمل بذاتها ALLOW فعّال يغطيه؛
 * ALLOW على عضوية تانية للمستخدم (مخصصة أو مدير سابق) مش بيكفي. وأي DENY يغطي الفرع من أي عضوية سارية له بيشيل الفرع،
 * إلا المالك الحقيقي فبيتجاهل كل DENY (من غير ما يكسب ALLOW من فراغ).
 *
 * @param scope        الشركة والنشاط المطلوب قراءة تقييماتهم
 * @param branchIds    كل فروع النشاط
 * @param members      العضويات السارية للمستخدم بأكواد أدوارها الحالية
 * @param grants       منح `read:ratings:branch` السارية للمستخدم بمصدر كل منحة
 * @param canonicalOwner هل المستخدم مالك حقيقي للشركة (يتجاهل الـ DENY)
 * @returns الفروع المسموحة بترتيب المدخل، وفاضية لو مفيش فرع مسموح
 */
export function readableRatingBranches(
  scope: RatingsReadScope,
  branchIds: readonly string[],
  members: readonly RatingsReadMembership[],
  grants: readonly RatingsReadGrant[],
  canonicalOwner: boolean,
): readonly string[] {
  const managers = members.filter(
    (m) => m.systemRoleCode !== null && RATINGS_READ_ROLES.includes(m.systemRoleCode),
  );
  return branchIds.filter((branchId) => {
    const covering = grants.filter((g) => coversBranch(g, scope, branchId));
    if (!canonicalOwner && covering.some((g) => g.effect === 'DENY')) return false;
    const allowing = new Set(
      covering.filter((g) => g.effect === 'ALLOW').map((g) => g.membershipId),
    );
    return managers.some((m) => coversBranch(m, scope, branchId) && allowing.has(m.membershipId));
  });
}

/**
 * نطاق الشركة يغطي كل أفرعها، ونطاق النشاط يغطي فروعه، ونطاق الفرع يغطيه وحده.
 *
 * @param holder منحة أو عضوية نطاقها يُقاس
 * @param holder.scopeType مستوى النطاق: شركة أو نشاط أو فرع
 * @param holder.scopeId معرّف الشركة أو النشاط أو الفرع الذي يغطيه النطاق
 * @param scope الشركة والنشاط
 * @param branchId الفرع المقاس عليه
 * @returns هل النطاق يغطي الفرع
 */
function coversBranch(
  holder: { readonly scopeType: ScopeType; readonly scopeId: string },
  scope: RatingsReadScope,
  branchId: string,
): boolean {
  if (holder.scopeType === 'COMPANY') return holder.scopeId === scope.companyId;
  if (holder.scopeType === 'BUSINESS') return holder.scopeId === scope.businessId;
  return holder.scopeId === branchId;
}
