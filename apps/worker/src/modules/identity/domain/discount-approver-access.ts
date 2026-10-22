/**
 * DP-26 وDP-26b كما قرأها المنسّق (spec 057، ADR-0051 §7) وبقرار صاحب الطريق:
 * من يصل جرس طلب الموافقة هو كل مستخدم داخل الشركة أي عضوية نشطة تغطي الفرع وتمنح
 * approve:discounts:branch بذاتها: بدورها، أو بمنح ALLOW خاص لها على نطاق يغطي الفرع.
 * فالمخوّل هو صاحب عضوية تغطي الفرع وعضويته نفسها تمنح الصلاحية (D-11)، ومنح ALLOW
 * على عضوية لا تغطي الفرع لا يحسب حتى لو سمّى نطاقه هذا الفرع.
 * ولا DENY يغطي الفرع من أي عضوية نشطة للمستخدم — نطاق الـ DENY مستقل عن نطاق عضويته —
 * إلا من يحمل عضوية المالك: يتجاهل كل DENY كما في protectOwnerAccess.
 * ليس قاعدة المديرين في ADR-0037 ولا branchManagerRecipients: الكاشير الذي مُنح الصلاحية باسمه داخل.
 * القاعدة نفسها في DP-26: عضوية نشطة تغطي الفرع وتمنح الصلاحية بذاتها.
 */

/** مستوى النطاق الذي تغطيه منحة أو عضوية. */
export type DiscountApproverScopeType = 'COMPANY' | 'BUSINESS' | 'BRANCH';

/** الفرع الذي طُلبت الموافقة عليه؛ حدود النطاق تُقاس عليه لا على الشركة كلها. */
export interface DiscountApproverBranch {
  readonly companyId: string;
  readonly businessId: string;
  readonly branchId: string;
}

/** عضوية نشطة لمستخدم، مع علم أن نطاقها يغطي الفرع (يُحسب في SQL لا في القاعدة). */
export interface DiscountApproverMembership {
  readonly userId: string;
  readonly membershipId: string;
  readonly covers: boolean;
}

/** منحة واحدة: من دور العضوية أو من override، ولكلٍّ نطاقها الخاص. */
export interface DiscountApproverGrant {
  readonly userId: string;
  readonly membershipId: string;
  readonly effect: 'ALLOW' | 'DENY';
  readonly scopeType: DiscountApproverScopeType;
  readonly scopeId: string;
}

/** مدخلات القرار: الفرع، وعضويات المستخدمين النشطة، ومن يحملون عضوية المالك، والمنح. */
export interface DiscountApproverInput {
  readonly branch: DiscountApproverBranch;
  readonly memberships: readonly DiscountApproverMembership[];
  readonly owners: readonly string[];
  readonly grants: readonly DiscountApproverGrant[];
}

/**
 * يقرر من يصل الجرس: مستخدم واحد لكل id، مرتباً، بلا تكرار.
 * القاعدة: عضوية نشطة تغطي الفرع (أ) وتمنح approve:discounts:branch بذاتها — بدورها أو بمنح
 * ALLOW خاص لها على نطاق يغطي الفرع (ب) — ولا DENY يغطي الفرع من أي عضوية نشطة للمستخدم (ج)،
 * إلا أن من يحمل عضوية المالك يتجاهل كل DENY.
 * ومنح ALLOW على عضوية لا تغطي الفرع لا يحسب، حتى لو سمّى نطاقه هذا الفرع.
 *
 * @param input الفرع والعضويات النشطة ومن يحملون عضوية المالك والمنح المقروءة
 * @returns معرفات المستخدمين المؤهلين مرتبة تصاعدياً
 */
export function decideDiscountApprovers(input: DiscountApproverInput): readonly string[] {
  const owners = new Set(input.owners);
  const decided: string[] = [];
  for (const userId of new Set(input.memberships.map((membership) => membership.userId))) {
    const memberships = input.memberships.filter((membership) => membership.userId === userId);
    const grants = input.grants.filter((grant) => grant.userId === userId);
    const denied = grants.some(
      (grant) => grant.effect === 'DENY' && coversBranch(grant, input.branch),
    );
    if (denied && !owners.has(userId)) continue;
    const granted = memberships.some(
      (membership) =>
        membership.covers &&
        grants.some(
          (grant) =>
            grant.membershipId === membership.membershipId &&
            grant.effect === 'ALLOW' &&
            coversBranch(grant, input.branch),
        ),
    );
    if (granted) decided.push(userId);
  }
  return decided.sort();
}

/**
 * نطاق الشركة يغطي كل أفرعها، ونطاق النشاط يغطي فروعه، ونطاق الفرع يغطيه وحده.
 *
 * @param grant المنحة التي نطاقها يُقاس
 * @param branch الفرع الذي طُلبت الموافقة عليه
 * @returns هل نطاق المنحة يغطي الفرع
 */
function coversBranch(grant: DiscountApproverGrant, branch: DiscountApproverBranch): boolean {
  if (grant.scopeType === 'COMPANY') return grant.scopeId === branch.companyId;
  if (grant.scopeType === 'BUSINESS') return grant.scopeId === branch.businessId;
  return grant.scopeId === branch.branchId;
}
