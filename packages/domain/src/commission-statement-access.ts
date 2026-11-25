/**
 * المسند المشترك لمستلمي إشعارات كشف العمولة (FR-030، CM-58b).
 *
 * القاعدة: لا أحد يُطالب بفعل ترفضه نقطة النهاية. مطالبة المراجعة أو الاعتماد تروح
 * لمن يحمل صلاحية الفعل على **النشاط كله** (نطاق شركة أو نطاق النشاط، لا نطاق فرع)
 * **و** يقرأ النشاط كله: منحة `read:commissions:business` على الشركة أو النشاط
 * بلا أي DENY ساري يغطي الشركة أو النشاط أو أي فرع من فروع النشاط.
 *
 * نفس الدالة بتتحكم في حراسة نقطة النهاية (API) وفي اختيار المستلمين (worker)،
 * فما يصح يبقى فيه نسختان من القاعدة (CM-58b: «وحدة تثبت إن فلتر المستلمين
 * وحراسة المراجعة والاعتماد بتنادي نفس المسند»).
 */

/** مستوى النطاق الذي تغطيه منحة أو عضوية. */
export type CommissionAccessScopeType = 'COMPANY' | 'BUSINESS' | 'BRANCH';

/** صلاحية الفعل التي تُطلب مطالبة عليها: مراجعة الكشف أو اعتماده. */
export type CommissionActionPermission =
  | 'review:commissions:business'
  | 'approve:commissions:business';

/** صلاحية قراءة كشف العمولة على مستوى النشاط؛ شرط القراءة على مستوى النشاط كله. */
export const COMMISSION_READ_PERMISSION = 'read:commissions:business';

/** منحة واحدة وصلاحية واحدة: من دور العضوية أو من override، بالنطاق الخاص بها. */
export interface CommissionAccessGrant {
  readonly permission: string;
  readonly effect: 'ALLOW' | 'DENY';
  readonly scopeType: CommissionAccessScopeType;
  readonly scopeId: string;
}

/** مدخلات فحص فاعل واحد: الشركة والنشاط وفروعه والمنح وصلاحية الفعل المطلوبة. */
export interface CommissionActorInput {
  readonly companyId: string;
  readonly businessId: string;
  /** فروع النشاط كله؛ DENY على أي فرع منها يمنع القراءة على مستوى النشاط. */
  readonly businessBranchIds: readonly string[];
  readonly actionPermission: CommissionActionPermission;
  readonly grants: readonly CommissionAccessGrant[];
  /**
   * هل الفاعل مالك canonical للشركة (ADR-0025). المالك يتجاهل أي DENY على القراءة،
   * فهو يبقى على نطاق النشاط. الـ API بيطبّق الحماية دي قبل النداء (protectOwnerAccess)
   * والـ worker بيقرأها صراحةً من قاعدة البيانات.
   */
  readonly isCanonicalOwner?: boolean;
}

/** عضو فعّال في الشركة مع منحه؛ المرشح الواحد في قائمة المستلمين. */
export interface CommissionActorMember {
  readonly userId: string;
  readonly grants: readonly CommissionAccessGrant[];
  readonly isCanonicalOwner?: boolean;
}

/** مدخلات قرار قائمة المستلمين: الشركة والنشاط وفروعه والمنح لكل عضو. */
export interface CommissionActorsInput {
  readonly companyId: string;
  readonly businessId: string;
  readonly businessBranchIds: readonly string[];
  readonly actionPermission: CommissionActionPermission;
  readonly members: readonly CommissionActorMember[];
}

/**
 * منحة على مستوى الشركة أو النشاط بتغطي النشاط كله؛ منحة نطاقها فرع ما بتغطيش نشاط.
 *
 * @param grant المنحة التي نطاقها يُقاس
 * @param companyId الشركة المستهدفة
 * @param businessId النشاط المستهدف
 * @returns هل نطاق المنحة يغطي النشاط
 */
function coversBusiness(
  grant: CommissionAccessGrant,
  companyId: string,
  businessId: string,
): boolean {
  if (grant.scopeType === 'COMPANY') return grant.scopeId === companyId;
  if (grant.scopeType === 'BUSINESS') return grant.scopeId === businessId;
  return false;
}

/**
 * هل الفاعل يملك صلاحية الفعل على النشاط؟ الـ DENY في نطاق يغطي النشاط بيكسب،
 * ومنحة نطاقها فرع ما بتغطيش نشاط أصلاً (CS-Q26 = PP-24.1).
 *
 * @param input الشركة والنشاط والمنح وصلاحية الفعل
 * @returns هل صلاحية الفعل مسموحة
 */
function holdsActionPermission(input: CommissionActorInput): boolean {
  const applicable = effectiveGrants(input.grants, input.isCanonicalOwner).filter(
    (grant) =>
      grant.permission === input.actionPermission &&
      coversBusiness(grant, input.companyId, input.businessId),
  );
  if (applicable.some((grant) => grant.effect === 'DENY')) return false;
  return applicable.some((grant) => grant.effect === 'ALLOW');
}

/** مدخلات القراءة على مستوى النشاط: الشركة والنشاط وفروعه والمنح ووسم المالك. */
export interface CommissionReadInput {
  readonly companyId: string;
  readonly businessId: string;
  /** فروع النشاط كله؛ DENY على أي فرع منها يمنع القراءة على مستوى النشاط. */
  readonly businessBranchIds: readonly string[];
  readonly grants: readonly CommissionAccessGrant[];
  /**
   * هل الفاعل مالك canonical للشركة (ADR-0025). المالك يتجاهل أي DENY على القراءة،
   * فهو يبقى على نطاق النشاط. الـ API بيطبّق الحماية دي قبل النداء (protectOwnerAccess)
   * والـ worker بيقرأها صراحةً من قاعدة البيانات.
   */
  readonly isCanonicalOwner?: boolean;
}

/**
 * حماية المالك (ADR-0025): المالك canonical بيتجاهل كل DENY على صلاحيات الشركة، فسلطته ما بتقلّش
 * بمنحة على عضوية شقيقة. نفس القاعدة اللي `protectOwnerAccess` بتطبّقها في الـ API، عشان طرفَي
 * المسند (حراسة نقطة النهاية وفلتر المستلمين) يطلعوا بنفس النتيجة.
 *
 * @param grants المنح المقروءة
 * @param isCanonicalOwner هل الفاعل مالك canonical للشركة
 * @returns المنح بعد تطبيق حماية المالك
 */
function effectiveGrants(
  grants: readonly CommissionAccessGrant[],
  isCanonicalOwner: boolean | undefined,
): readonly CommissionAccessGrant[] {
  if (isCanonicalOwner !== true) return grants;
  return grants.filter((grant) => grant.effect !== 'DENY');
}

/**
 * هل الفاعل قارئ النشاط كله؟ منحة ALLOW على الشركة أو النشاط، بلا DENY ساري
 * يغطي الشركة أو النشاط أو أي فرع من فروع النشاط — إلا المالك (ADR-0025).
 *
 * @param input الشركة والنشاط وفروعه والمنح ووسم المالك
 * @returns هل القراءة على مستوى النشاط كله
 */
export function readsCommissionBusinessWide(input: CommissionReadInput): boolean {
  const mine = effectiveGrants(input.grants, input.isCanonicalOwner).filter(
    (grant) => grant.permission === COMMISSION_READ_PERMISSION,
  );
  const allows = mine.filter((grant) => grant.effect === 'ALLOW');
  if (!allows.some((grant) => coversBusiness(grant, input.companyId, input.businessId))) {
    return false;
  }
  const denied = mine.some(
    (grant) =>
      grant.effect === 'DENY' &&
      (coversBusiness(grant, input.companyId, input.businessId) ||
        (grant.scopeType === 'BRANCH' &&
          input.businessBranchIds.includes(grant.scopeId))),
  );
  return !denied;
}

/**
 * يقرر إن كان الفاعل مؤهلاً لمطالبة على كشف النشاط: يحمل صلاحية الفعل على النشاط
 * **و** هو قارئ للنشاط كله. نفس الدالة بتستعملها حراسة نقطة النهاية وفلتر المستلمين.
 *
 * @param input الشركة والنشاط وفروعه والمنح وصلاحية الفعل ووسم المالك
 * @returns هل الفاعل مؤهل
 */
export function isBusinessWideCommissionActor(input: CommissionActorInput): boolean {
  if (!holdsActionPermission(input)) return false;
  return readsCommissionBusinessWide({
    companyId: input.companyId,
    businessId: input.businessId,
    businessBranchIds: input.businessBranchIds,
    grants: input.grants,
    ...(input.isCanonicalOwner === undefined
      ? {}
      : { isCanonicalOwner: input.isCanonicalOwner }),
  });
}

/**
 * يختار المستلمين المؤهلين من أعضاء الشركة: نفس مسند الفاعل الواحد بالظبط،
 * بمعرّفات بلا تكرار ومرتبة تصاعدياً (الترتيب جزء من عقد الحدث، FR-030).
 *
 * @param input الشركة والنشاط وفروعه والمنح لكل عضو وصلاحية الفعل
 * @returns معرّفات المستخدمين المؤهلين مرتبة تصاعدياً بلا تكرار
 */
export function decideBusinessWideCommissionActors(
  input: CommissionActorsInput,
): readonly string[] {
  const holders = new Set<string>();
  for (const member of input.members) {
    if (member.userId === '') continue;
    const eligible = isBusinessWideCommissionActor({
      companyId: input.companyId,
      businessId: input.businessId,
      businessBranchIds: input.businessBranchIds,
      actionPermission: input.actionPermission,
      grants: member.grants,
      ...(member.isCanonicalOwner === undefined
        ? {}
        : { isCanonicalOwner: member.isCanonicalOwner }),
    });
    if (eligible) holders.add(member.userId);
  }
  return [...holders].sort();
}
