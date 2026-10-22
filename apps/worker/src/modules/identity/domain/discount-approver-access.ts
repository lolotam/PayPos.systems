/**
 * DP-26 وDP-26b كما قرأها المنسّق (spec 057، ADR-0051 §7) وبقرار صاحب الطريق:
 * من يصل جرس طلب الموافقة هو كل مستخدم داخل الشركة أي عضوية نشطة باسمها تمنح approve:discounts:branch
 * على نطاق يغطي الفرع. ومنح الدور يحمل نطاق العضوية نفسه، فهي تغطي الفرع حين تغطيه العضوية؛
 * ومنح الـ override يحمل نطاقه هو، ولا يشترط أن تغطي عضويته الفرع — فالكاشير عضويته على فرع آخر
 * وممنوح الصلاحية باسمه على هذا الفرع يصله الجرس. ولا DENY يغطي الفرع من أي عضوية نشطة للمستخدم،
 * إلا من يحمل عضوية المالك: يتجاهل كل DENY كما في protectOwnerAccess.
 * ليس قاعدة المديرين في ADR-0037 ولا branchManagerRecipients: الكاشير الذي مُنح الصلاحية باسمه داخل.
 * القاعدة نفسها في DP-26: عضوية نشطة تمنح الصلاحية بذاتها، ومن نالها بنطاق يغطي الفرع يصله الجرس.
 */

/** مستوى النطاق الذي تغطيه منحة أو عضوية. */
export type DiscountApproverScopeType = 'COMPANY' | 'BUSINESS' | 'BRANCH';

/** الفرع الذي طُلبت الموافقة عليه؛ حدود النطاق تُقاس عليه لا على الشركة كلها. */
export interface DiscountApproverBranch {
  readonly companyId: string;
  readonly businessId: string;
  readonly branchId: string;
}

/** منحة واحدة: من دور العضوية أو من override، ولكلٍّ نطاقها الخاص. */
export interface DiscountApproverGrant {
  readonly userId: string;
  readonly membershipId: string;
  readonly effect: 'ALLOW' | 'DENY';
  readonly scopeType: DiscountApproverScopeType;
  readonly scopeId: string;
}

/** مدخلات القرار: الفرع، ومن يحملون عضوية المالك، والمنح المقروءة. */
export interface DiscountApproverInput {
  readonly branch: DiscountApproverBranch;
  readonly owners: readonly string[];
  readonly grants: readonly DiscountApproverGrant[];
}

/**
 * يقرر من يصل الجرس: مستخدم واحد لكل id، مرتباً، بلا تكرار.
 * القاعدة: منحة ALLOW واحدة من أي عضوية نشطة باسمها، ونطاقها يغطي الفرع، تكفي (ب) — ونطاق منحة الـ override
 * هو نطاقها هي، فلا يشترط أن تغطي عضويتها الفرع — ولا DENY يغطي الفرع من أي عضوية نشطة للمستخدم (ج)،
 * إلا أن من يحمل عضوية المالك يتجاهل كل DENY.
 *
 * @param input الفرع ومن يحملون عضوية المالك والمنح المقروءة
 * @returns معرفات المستخدمين المؤهلين مرتبة تصاعدياً
 */
export function decideDiscountApprovers(input: DiscountApproverInput): readonly string[] {
  const owners = new Set(input.owners);
  const decided: string[] = [];
  for (const userId of new Set(input.grants.map((grant) => grant.userId))) {
    const grants = input.grants.filter((grant) => grant.userId === userId);
    const denied = grants.some(
      (grant) => grant.effect === 'DENY' && coversBranch(grant, input.branch),
    );
    if (denied && !owners.has(userId)) continue;
    const granted = grants.some(
      (grant) => grant.effect === 'ALLOW' && coversBranch(grant, input.branch),
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
