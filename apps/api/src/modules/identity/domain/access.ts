/**
 * مستوى النطاق اللي صلاحية أو عضوية بتغطيه.
 */
export type ScopeType = 'COMPANY' | 'BUSINESS' | 'BRANCH';

/**
 * قيود الصلاحية الرقمية أو المنطقية المحمولة من role_permissions (ADR-0003 §4).
 * المبالغ المالية (`max_amount` و `max_variance`) محفوظة بالملّيم الصحيح (`bigint`، 1 KWD = 1000n).
 */
export interface PermissionConstraints {
  readonly max_pct?: number;
  readonly max_amount?: bigint;
  readonly max_variance?: bigint;
  readonly backdate_days?: number;
  readonly manual_edit?: boolean;
  readonly max_rows?: number;
  /** علامة فساد القيد المخزن: تمنع تحويل القيد التالف إلى صلاحية مفتوحة بلا حدود. */
  readonly invalid?: boolean;
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

const MONEY_MAX_MILLS = 99_999_999_999_999n;
const INTEGER_CONSTRAINTS = ['backdate_days', 'max_rows'] as const;
const MONEY_CONSTRAINTS = ['max_amount', 'max_variance'] as const;

type MutableConstraints = {
  max_pct?: number;
  max_amount?: bigint;
  max_variance?: bigint;
  backdate_days?: number;
  manual_edit?: boolean;
  max_rows?: number;
};

const isValidPct = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100;

const isValidNonNegInt = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;

function parseMills(value: unknown): bigint | null {
  if (typeof value === 'bigint') return value >= 0n && value <= MONEY_MAX_MILLS ? value : null;
  if (isValidNonNegInt(value)) {
    const mills = BigInt(value);
    return mills <= MONEY_MAX_MILLS ? mills : null;
  }
  if (typeof value === 'string' && /^\d+$/.test(value)) {
    const mills = BigInt(value);
    return mills <= MONEY_MAX_MILLS ? mills : null;
  }
  return null;
}

function assignConstraint(parsed: MutableConstraints, key: string, value: unknown): boolean {
  if (key === 'max_pct') {
    if (!isValidPct(value)) return false;
    parsed.max_pct = value;
    return true;
  }
  if (key === 'backdate_days' || key === 'max_rows') {
    if (!isValidNonNegInt(value)) return false;
    parsed[key] = value;
    return true;
  }
  if (key === 'max_amount' || key === 'max_variance') {
    const mills = parseMills(value);
    if (mills === null) return false;
    parsed[key] = mills;
    return true;
  }
  if (key === 'manual_edit') {
    if (typeof value !== 'boolean') return false;
    parsed.manual_edit = value;
    return true;
  }
  return false;
}

/**
 * بيقرأ كائن القيود الخام من جدول role_permissions ويرجّع القيود الصالحة أو undefined لو فاضي.
 * لو القيد تالف أو فيه مفتاح أو قيمة غير صالحة بيرجع `{ invalid: true }` عشان الدمج يرفض بأمان (fail-closed)
 * وما يقلبش القيد المكسور لصلاحية مفتوحة بلا حدود.
 *
 * @param raw القيمة الخام اللي جاية من عمود constraints (jsonb)
 * @returns القيود الصالحة، أو undefined لو {} فاضي، أو `{ invalid: true }` لو تالف
 */
export function parsePermissionConstraints(raw: unknown): PermissionConstraints | undefined {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return { invalid: true };
  const entries = Object.entries(raw);
  if (entries.length === 0) return undefined;
  const parsed: MutableConstraints = {};
  for (const [key, value] of entries) {
    if (!assignConstraint(parsed, key, value)) return { invalid: true };
  }
  return parsed;
}

function mergeOneGrant(merged: MutableConstraints, current: PermissionConstraints): boolean {
  if (current.invalid === true) return false;
  if (current.max_pct !== undefined) {
    if (!isValidPct(current.max_pct)) return false;
    merged.max_pct =
      merged.max_pct === undefined ? current.max_pct : Math.min(merged.max_pct, current.max_pct);
  }
  for (const key of INTEGER_CONSTRAINTS) {
    const value = current[key];
    if (value === undefined) continue;
    if (!isValidNonNegInt(value)) return false;
    const existing = merged[key];
    merged[key] = existing === undefined ? value : Math.min(existing, value);
  }
  for (const key of MONEY_CONSTRAINTS) {
    const value = current[key];
    if (value === undefined) continue;
    if (typeof value !== 'bigint' || value < 0n || value > MONEY_MAX_MILLS) return false;
    const existing = merged[key];
    merged[key] = existing === undefined ? value : value < existing ? value : existing;
  }
  if (current.manual_edit !== undefined) {
    if (typeof current.manual_edit !== 'boolean') return false;
    merged.manual_edit =
      merged.manual_edit === undefined
        ? current.manual_edit
        : merged.manual_edit && current.manual_edit;
  }
  return true;
}

/**
 * بيجمع قيود المنح المغطّية لما الطلب مسموح عند الـ target (ADR-0003 §4، #10).
 * لما كذا GRANT بتغطي نفس الصلاحية والهدف، أضيق قيد هو اللي بيكسب (أصغر رقم، و false لـ manual_edit)
 * تماشياً مع قاعدة DENY يكسب. بيرجّع null لو الطلب مرفوض أو لو فيه قيد تالف (`invalid: true`).
 *
 * @param grants     كل صلاحيات الـ principal في الشركة
 * @param permission الصلاحية المطلوبة
 * @param target     الهدف المطلوب تقييمه
 * @returns القيود المجمعة لو مسموح (أو {} لو من غير قيود)، أو null لو مرفوض أو تالف
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
    if (grant.constraints !== undefined && !mergeOneGrant(merged, grant.constraints)) return null;
  }
  return merged;
}
