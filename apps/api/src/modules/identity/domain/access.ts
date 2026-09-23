/**
 * مستوى النطاق اللي صلاحية أو عضوية بتغطيه.
 */
export type ScopeType = 'COMPANY' | 'BUSINESS' | 'BRANCH';

/**
 * صلاحية واحدة اتجمعت للـ principal: من role أو من override، بالـ effect بتاعها والنطاق اللي بتغطيه.
 */
export interface AccessGrant {
  readonly permission: string;
  readonly effect: 'ALLOW' | 'DENY';
  readonly scopeType: ScopeType;
  readonly scopeId: string;
}

/**
 * الحاجة اللي الطلب بيلمسها: الشركة دايماً، والـ business والفرع لو الـ route بيحددهم.
 * الفرع لازم ييجي ومعاه الـ business بتاعه (بيتجاب من الداتابيز، مش من الـ client).
 */
export interface AccessTarget {
  readonly companyId: string;
  readonly businessId?: string;
  readonly branchId?: string;
}

const SCOPES = ['platform', 'company', 'business', 'branch'] as const;

/**
 * الـ scope اللي في آخر الصلاحية ('manage:orders:branch' ← 'branch') — ده اللي بيحدد الـ route محتاج target إيه.
 *
 * @param permission الصلاحية بالشكل 'action:resource:scope'
 * @returns الـ scope، أو null لو الصلاحية مش بالشكل ده
 */
export function permissionScope(permission: string): (typeof SCOPES)[number] | null {
  const scope = permission.split(':')[2];
  return SCOPES.find((known) => known === scope) ?? null;
}

// صلاحية الشركة بتغطي كل business وكل فرع فيها، وصلاحية الـ business بتغطي فروعه، وصلاحية الفرع بتغطيه هو بس.
function covers(grant: AccessGrant, target: AccessTarget): boolean {
  switch (grant.scopeType) {
    case 'COMPANY':
      return grant.scopeId === target.companyId;
    case 'BUSINESS':
      return target.businessId !== undefined && grant.scopeId === target.businessId;
    case 'BRANCH':
      return target.branchId !== undefined && grant.scopeId === target.branchId;
  }
}

/**
 * بيقرر هل الطلب مسموح: الـ DENY بيكسب في أي نطاق بيغطي الـ target، وإلا ALLOW واحد يكفي، وإلا مرفوض.
 * التقييم بيحصل عند الـ target نفسه عشان ALLOW واسع على الـ business و DENY ضيق على فرع يفضلوا الاتنين
 * (ADR-0003 §4، PRD D-31): الفرع الممنوع مرفوض وباقي الفروع مسموحة.
 *
 * @param grants     كل صلاحيات الـ principal في الشركة دي، بالـ DENY بتاعتها
 * @param permission الصلاحية المطلوبة للـ route
 * @param target     الشركة (والـ business والفرع لو موجودين) اللي الطلب بيلمسها
 * @returns true لو مسموح، false لو مرفوض (ومفيش حاجة مطابقة = مرفوض)
 */
export function evaluateAccess(
  grants: readonly AccessGrant[],
  permission: string,
  target: AccessTarget,
): boolean {
  const applicable = grants.filter((g) => g.permission === permission && covers(g, target));
  if (applicable.some((g) => g.effect === 'DENY')) return false;
  return applicable.some((g) => g.effect === 'ALLOW');
}
