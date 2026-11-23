/**
 * من يقرأ نص تعليق التقييم (spec 060 BR-B4، RT-Q7b): مدير بأحد الأدوار الأربعة بدوره الحالي،
 * وعضويته تغطي الفرع وتمنح read:ratings:branch بذاتها، ولا DENY يغطي الفرع من أي عضوية نشطة له.
 * نفس قاعدة readableRatingBranches في API الهوية (شاشة التقييمات)، والجانبان يُختبران بجدول حالات واحد (ratings-comment-rule-cases.ts)
 * فلا يظهر تعليق في الجرس ويختفي من الشاشة ولا العكس.
 */

/** مستوى النطاق الذي تغطيه منحة أو عضوية. */
export type RatingCommentScopeType = 'COMPANY' | 'BUSINESS' | 'BRANCH';

/** الفرع الذي كُتب عنده التقييم؛ حدود النطاق تُقاس عليه لا على الشركة كلها. */
export interface RatingCommentBranch {
  readonly companyId: string;
  readonly businessId: string;
  readonly branchId: string;
}

/** عضوية نشطة لمستخدم، بعلمين يُحسبان في SQL: دورها الحالي من المديرين الأربعة، ونطاقها يغطي الفرع. */
export interface RatingCommentMembership {
  readonly userId: string;
  readonly membershipId: string;
  readonly manager: boolean;
  readonly covers: boolean;
}

/** منحة واحدة: من دور العضوية أو من override، ولكلٍّ نطاقها الخاص. */
export interface RatingCommentGrant {
  readonly userId: string;
  readonly membershipId: string;
  readonly effect: 'ALLOW' | 'DENY';
  readonly scopeType: RatingCommentScopeType;
  readonly scopeId: string;
}

/** مدخلات القرار: الفرع والمرشحون وعضوياتهم النشطة ومن يحملون عضوية المالك والمنح المقروءة. */
export interface RatingCommentInput {
  readonly branch: RatingCommentBranch;
  readonly userIds: readonly string[];
  readonly memberships: readonly RatingCommentMembership[];
  readonly owners: readonly string[];
  readonly grants: readonly RatingCommentGrant[];
}

/**
 * يقرر من يقرأ نص التعليق: مستخدم واحد لكل id، مرتباً، بلا تكرار، ومن المرشحين وحدهم.
 * القاعدة: عضوية مدير تغطي الفرع تحمل منحة ALLOW تغطيه (أ)، ولا DENY يغطي الفرع من أي عضوية
 * نشطة للمستخدم ولو كانت عضوية غير مدير (ب)، إلا من يحمل عضوية المالك فيتجاهل كل DENY؛
 * والمالك لا يُمنح ALLOW من فراغ، فلا بد من منحة (أ) له كذلك.
 *
 * @param input الفرع والمرشحون والعضويات النشطة ومن يحملون عضوية المالك والمنح المقروءة
 * @returns معرفات المستخدمين المؤهلين مرتبة تصاعدياً
 */
export function decideRatingCommentReaders(input: RatingCommentInput): readonly string[] {
  const owners = new Set(input.owners);
  // فهرسة بالمستخدم مرة واحدة: التكلفة بحجم المدخلات مش المرشحين × المنح، لأن عدد المستلمين مفيش له سقف.
  const grantsByUser = groupBy(input.grants, (grant) => grant.userId);
  const membershipsByUser = groupBy(input.memberships, (membership) => membership.userId);
  const readers: string[] = [];
  for (const userId of new Set(input.userIds)) {
    const grants = grantsByUser.get(userId) ?? [];
    const denied = grants.some(
      (grant) => grant.effect === 'DENY' && coversBranch(grant, input.branch),
    );
    if (denied && !owners.has(userId)) continue;
    const allowing = new Set(
      grants
        .filter((grant) => grant.effect === 'ALLOW' && coversBranch(grant, input.branch))
        .map((grant) => grant.membershipId),
    );
    const allowed = (membershipsByUser.get(userId) ?? []).some(
      (membership) =>
        membership.manager && membership.covers && allowing.has(membership.membershipId),
    );
    if (allowed) readers.push(userId);
  }
  return readers.sort();
}

/**
 * يجمّع العناصر بمفتاح في مرور واحد، بنفس ترتيب ظهورها.
 *
 * @param items العناصر المراد تجميعها
 * @param key دالة تستخرج مفتاح التجميع من العنصر
 * @returns العناصر مجمّعة بالمفتاح
 */
function groupBy<T>(items: readonly T[], key: (item: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const group = groups.get(key(item));
    if (group === undefined) groups.set(key(item), [item]);
    else group.push(item);
  }
  return groups;
}

/**
 * نطاق الشركة يغطي كل أفرعها، ونطاق النشاط يغطي فروعه، ونطاق الفرع يغطيه وحده.
 *
 * @param grant المنحة التي نطاقها يُقاس
 * @param branch الفرع الذي كُتب عنده التقييم
 * @returns هل نطاق المنحة يغطي الفرع
 */
function coversBranch(grant: RatingCommentGrant, branch: RatingCommentBranch): boolean {
  if (grant.scopeType === 'COMPANY') return grant.scopeId === branch.companyId;
  if (grant.scopeType === 'BUSINESS') return grant.scopeId === branch.businessId;
  return grant.scopeId === branch.branchId;
}
