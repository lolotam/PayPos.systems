/**
 * مستوى النطاق اللي صلاحية أو عضوية بتغطيه.
 */
export type ScopeType = 'COMPANY' | 'BUSINESS' | 'BRANCH';

/**
 * قيود الصلاحية الرقمية أو المنطقية المحمولة من role_permissions (ADR-0003 §4).
 */
export interface PermissionConstraints {
  readonly max_pct?: number;
  readonly max_amount?: number;
  readonly max_variance?: number;
  readonly backdate_days?: number;
  readonly manual_edit?: boolean;
  readonly max_rows?: number;
}

/**
 * صلاحية واحدة اتجمعت للـ principal: من role أو من override، بالـ effect بتاعها والنطاق اللي بتغطيه.
 */
export interface AccessGrant {
  readonly permission: string;
  readonly effect: 'ALLOW' | 'DENY';
  readonly scopeType: ScopeType;
  readonly scopeId: string;
  readonly constraints?: PermissionConstraints;
}

/**
 * الحاجة اللي الطلب بيلمسها: الشركة دايماً، والـ business والفرع لو الـ route بيحددهم.
 * الفرع لازم ييجي ومعاه الـ business بتاعه (بيتجاب من الداتابيز، مش من الـ client).
 */
export interface AccessTarget {
  readonly companyId: string;
  readonly businessId?: string;
  readonly branchId?: string;
  /** هوية الفاعل المثبتة؛ وجود own وحده لا يثبت الملكية. */
  readonly actorUserId?: string;
  /** هوية صاحب المورد من السجل أو رابط الموظف، لا من العميل. */
  readonly subjectUserId?: string;
}

const SCOPES = ['platform', 'company', 'business', 'branch', 'own'] as const;

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
  if (
    permissionScope(permission) === 'own' &&
    (target.actorUserId === undefined ||
      target.subjectUserId === undefined ||
      target.actorUserId !== target.subjectUserId)
  )
    return false;
  const applicable = grants.filter((g) => g.permission === permission && covers(g, target));
  if (applicable.some((g) => g.effect === 'DENY')) return false;
  return applicable.some((g) => g.effect === 'ALLOW');
}

const NUMERIC_CONSTRAINTS = [
  'max_pct',
  'max_amount',
  'max_variance',
  'backdate_days',
  'max_rows',
] as const;

type MutableConstraints = {
  max_pct?: number;
  max_amount?: number;
  max_variance?: number;
  backdate_days?: number;
  manual_edit?: boolean;
  max_rows?: number;
};

/**
 * بيقرأ كائن القيود الخام من جدول role_permissions ويرجّع القيود الصالحة أو undefined لو فاضي.
 * المنح اللي ملهاش قيود بتفضل من غير حقل constraints عشان شكلها يفضل ثابت.
 *
 * @param raw القيمة الخام اللي جاية من عمود constraints (jsonb)
 * @returns القيود الصالحة أو undefined لو مفيش قيود
 */
export function parsePermissionConstraints(raw: unknown): PermissionConstraints | undefined {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return undefined;
  const record = raw as Record<string, unknown>;
  const parsed: MutableConstraints = {};
  let hasAny = false;
  for (const key of NUMERIC_CONSTRAINTS) {
    const value = record[key];
    if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
      parsed[key] = value;
      hasAny = true;
    }
  }
  if (typeof record['manual_edit'] === 'boolean') {
    parsed.manual_edit = record['manual_edit'];
    hasAny = true;
  }
  return hasAny ? parsed : undefined;
}

/**
 * بيجمع قيود المنح المغطّية لما الطلب مسموح عند الـ target (ADR-0003 §4، #10).
 * لما كذا GRANT بتغطي نفس الصلاحية والهدف، أضيق قيد هو اللي بيكسب (أصغر رقم، و false لـ manual_edit)
 * تماشياً مع قاعدة DENY يكسب. بيرجّع null لو الطلب مرفوض أصلاً.
 *
 * @param grants     كل صلاحيات الـ principal في الشركة
 * @param permission الصلاحية المطلوبة
 * @param target     الهدف المطلوب تقييمه
 * @returns القيود المجمعة لو مسموح (أو {} لو من غير قيود)، أو null لو مرفوض
 */
export function mergeGrantConstraints(
  grants: readonly AccessGrant[],
  permission: string,
  target: AccessTarget,
): PermissionConstraints | null {
  if (!evaluateAccess(grants, permission, target)) return null;
  const merged: MutableConstraints = {};
  for (const grant of grants) {
    if (grant.permission !== permission || grant.effect !== 'ALLOW' || !covers(grant, target))
      continue;
    const current = grant.constraints;
    if (current === undefined) continue;
    for (const key of NUMERIC_CONSTRAINTS) {
      const value = current[key];
      if (value === undefined) continue;
      const existing = merged[key];
      merged[key] = existing === undefined ? value : Math.min(existing, value);
    }
    if (current.manual_edit !== undefined) {
      merged.manual_edit =
        merged.manual_edit === undefined
          ? current.manual_edit
          : merged.manual_edit && current.manual_edit;
    }
  }
  return merged;
}
