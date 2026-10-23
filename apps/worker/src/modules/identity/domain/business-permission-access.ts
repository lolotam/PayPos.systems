/**
 * من يملك صلاحية نشاط فعليًا (spec 060 §B.4، «PERMISSION_HOLDERS»): نفس دلالة evaluateAccess في API الهوية
 * عند هدف { companyId, businessId } مع حماية المالك من الـ DENY (protectOwnerAccess).
 * القاعدة: منحة تغطي النشاط هي ما جودته الشركة أو النشاط؛ منحة نطاقها فرع لا تغطي نشاطًا أبدًا.
 * والمالك يتجاهل كل DENY فلا تمنعه منحة رفض.
 */

/** مستوى النطاق الذي تغطيه منحة أو عضوية. */
export type BusinessPermissionScopeType = 'COMPANY' | 'BUSINESS' | 'BRANCH';

/** منحة واحدة: من دور العضوية أو من override، ولكلٍّ نطاقها الخاص. */
export interface BusinessPermissionGrant {
  readonly userId: string;
  readonly effect: 'ALLOW' | 'DENY';
  readonly scopeType: BusinessPermissionScopeType;
  readonly scopeId: string;
}

/** عضوية نشطة لمستخدم داخل الشركة؛ مستخدموها هم المرشحون. */
export interface BusinessPermissionMembership {
  readonly userId: string;
}

/** مدخلات القرار: الشركة والنشاط والمرشحون ومن يحملون عضوية المالك والمنح المقروءة. */
export interface BusinessPermissionInput {
  readonly companyId: string;
  readonly businessId: string;
  readonly userIds: readonly string[];
  readonly owners: readonly string[];
  readonly grants: readonly BusinessPermissionGrant[];
}

/**
 * يقرر من يملك الصلاحية على النشاط: مستخدم واحد لكل id، مرتباً، بلا تكرار.
 * القاعدة: منحة ALLOW تغطي النشاط تكفي، وإلا فلا أحد؛ ومنحة DENY تغطي النشاط تمنع إلا المالك.
 *
 * @param input الشركة والنشاط والمرشحون وأصحاب صلاحية المالك والمنح المقروءة
 * @returns معرفات المستخدمين المؤهلين مرتبة تصاعدياً
 */
export function decideBusinessPermissionHolders(
  input: BusinessPermissionInput,
): readonly string[] {
  const owners = new Set(input.owners);
  const holders: string[] = [];
  for (const userId of new Set(input.userIds)) {
    const applicable = input.grants.filter(
      (grant) => grant.userId === userId && coversBusiness(grant, input),
    );
    if (applicable.some((grant) => grant.effect === 'DENY') && !owners.has(userId)) continue;
    if (applicable.some((grant) => grant.effect === 'ALLOW')) holders.push(userId);
  }
  return holders.sort();
}

/**
 * نطاق الشركة يغطي كل أنشطتها، ونطاق النشاط يغطيه هو، ونطاق الفرع لا يغطي نشاطًا.
 *
 * @param grant المنحة التي نطاقها يُقاس
 * @param input الشركة والنشاط المستهدفان
 * @returns هل نطاق المنحة يغطي النشاط
 */
function coversBusiness(
  grant: BusinessPermissionGrant,
  input: BusinessPermissionInput,
): boolean {
  if (grant.scopeType === 'COMPANY') return grant.scopeId === input.companyId;
  if (grant.scopeType === 'BUSINESS') return grant.scopeId === input.businessId;
  return false;
}
