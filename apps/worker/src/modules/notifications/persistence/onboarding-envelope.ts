import {
  canonicalOwnerSql,
  systemRoleGrantAllowedSql,
  systemRoleOverrideAllowedSql,
  type TenantWrappers,
  type Tx,
} from '@pospay/db';
import {
  extractOnboardingOperationId,
  MEMBER_INVITATION_KEY,
  onboardingPlaceholderEmail,
  STAFF_WELCOME_PIN_KEY,
  unsealOnboardingEmailEnvelope,
  type OnboardingEmailPayload,
} from '@pospay/notifications';
import { sql } from 'drizzle-orm';

const STAFF_GRANT_PERMISSION = 'manage:staff-access:branch';
const INVITE_MANAGE_PERMISSION = 'manage:memberships:company';

/** لقطة المحاولة اللي كفاية لفك المظروف: الشركة والقالب والوجهة الموقّعة والمعاملات المسمّاة. */
export interface OnboardingEnvelopeAttempt {
  readonly companyId: string;
  readonly templateKey: string;
  readonly templateRevision: number;
  readonly email?: string | null | undefined;
  readonly safeParameters: readonly {
    readonly name?: unknown;
    readonly type?: unknown;
    readonly value?: unknown;
  }[];
}

/** بريد الترحيب ودعوة العضو: قالبان بيتفكوا من مظروف مشفّر بدل معاملات عادية. */
const ONBOARDING_TEMPLATE_KEYS: ReadonlySet<string> = new Set([
  STAFF_WELCOME_PIN_KEY,
  MEMBER_INVITATION_KEY,
]);

/**
 * يفحص إن المفتاح قالب ترحيب: بريد الترحيب بالموظفة أو دعوة العضو.
 *
 * @param key مفتاح القالب
 * @returns true لما القالب من قوالب الترحيب
 */
export function isOnboardingTemplate(key: string): boolean {
  return ONBOARDING_TEMPLATE_KEYS.has(key);
}

/**
 * يفك مظروف إيميل الترحيب: مربوط بالشركة والعملية والقالب والوجهة الموقّعة، وبيرفض أي تزوير أو انتهاء.
 *
 * @param attempt لقطة المحاولة
 * @param key مفتاح الختم
 * @param now اللحظة الحالية
 * @param options خيارات فك التشفير (تعطيل فحص العمر مطلوب فقط لمطابقة الوجهة)
 * @returns الحمولة، أو null لما المظروف مش سليم أو انتهى
 */
export function unsealAttempt(
  attempt: OnboardingEnvelopeAttempt,
  key: Buffer,
  now: Date,
  options: { readonly checkExpiry?: boolean } = {},
): OnboardingEmailPayload | null {
  const placeholder = attempt.email;
  const operationId = extractOnboardingOperationId(attempt.safeParameters);
  if (typeof placeholder !== 'string' || placeholder === '' || operationId === null) return null;
  return unsealOnboardingEmailEnvelope(
    key,
    attempt.safeParameters,
    {
      companyId: attempt.companyId,
      operationId,
      templateKey: attempt.templateKey,
      templateRevision: attempt.templateRevision,
      placeholderEmail: placeholder,
    },
    now,
    options,
  );
}

/** يتحقق أن الشركة نشطة ولم تُحذف ناعماً بعد. */
async function companyActive(tx: Tx, companyId: string): Promise<boolean> {
  const rows = await tx.execute(sql`
    SELECT 1 FROM companies WHERE id = ${companyId}::uuid AND deleted_at IS NULL`);
  return rows.length === 1;
}

/** يطابق البريد المختوم مع جهة الاتصال الحية للعضو داخل الشركة عبر القراءة المحدودة. */
async function matchesMemberContactEmail(
  tx: Tx,
  companyId: string,
  userId: string,
  expectedEmail: string,
): Promise<boolean> {
  const [contact] = await tx.execute<{ email: string | null }>(sql`
    SELECT email FROM public.team_alert_recipient_contacts(
      ${companyId}::uuid,
      ARRAY[${userId}::uuid],
      now(),
      false
    )
    WHERE user_id = ${userId}::uuid`);
  return (
    contact !== undefined &&
    contact.email !== null &&
    contact.email.trim().toLowerCase() === expectedEmail.trim().toLowerCase()
  );
}

/** نطاق الصلاحية المطلوب على الشركة أو النشاط أو الفرع الهدف. */
function branchScopeCoversSql(
  alias: string,
  companyId: string,
  businessId: string,
  branchId: string,
) {
  const scope = sql.identifier(alias);
  return sql`(
    (${scope}.scope_type = 'COMPANY' AND ${scope}.scope_id = ${companyId}::uuid)
    OR (${scope}.scope_type = 'BUSINESS' AND ${scope}.scope_id = ${businessId}::uuid)
    OR (${scope}.scope_type = 'BRANCH' AND ${scope}.scope_id = ${branchId}::uuid)
  )`;
}

/** يتحقق من بقاء عضوية المدير المانح وصلاحيته لإعطاء الدخول على الفرع وقت الإرسال. */
async function managerAuthorizedForBranch(
  tx: Tx,
  companyId: string,
  userId: string,
  businessId: string,
  branchId: string,
): Promise<boolean> {
  const [row] = await tx.execute<{ allowed: boolean | null }>(sql`
    SELECT (
      EXISTS (
        SELECT 1 FROM memberships m
        JOIN role_permissions rp ON rp.role_id = m.role_id AND rp.role_owner_key = m.role_owner_key
        WHERE m.company_id = ${companyId}::uuid AND m.user_id = ${userId}::uuid
          AND m.starts_at <= now() AND (m.ends_at IS NULL OR m.ends_at > now())
          AND rp.permission_code = ${STAFF_GRANT_PERMISSION}
          AND ${systemRoleGrantAllowedSql('m', 'rp')}
          AND ${branchScopeCoversSql('m', companyId, businessId, branchId)}
      )
      OR EXISTS (
        SELECT 1 FROM permission_overrides o
        JOIN memberships m ON m.company_id = o.company_id AND m.id = o.membership_id
        WHERE m.company_id = ${companyId}::uuid AND m.user_id = ${userId}::uuid
          AND m.starts_at <= now() AND (m.ends_at IS NULL OR m.ends_at > now())
          AND o.permission_code = ${STAFF_GRANT_PERMISSION}
          AND o.effect = 'ALLOW'
          AND (o.expires_at IS NULL OR o.expires_at > now())
          AND ${systemRoleOverrideAllowedSql('m', 'o', STAFF_GRANT_PERMISSION)}
          AND ${branchScopeCoversSql('o', companyId, businessId, branchId)}
      )
    ) AND (
      EXISTS (
        SELECT 1 FROM memberships om
        WHERE om.company_id = ${companyId}::uuid AND om.user_id = ${userId}::uuid
          AND om.starts_at <= now() AND (om.ends_at IS NULL OR om.ends_at > now())
          AND ${canonicalOwnerSql('om', companyId)}
      )
      OR NOT EXISTS (
        SELECT 1 FROM permission_overrides o
        JOIN memberships m ON m.company_id = o.company_id AND m.id = o.membership_id
        WHERE m.company_id = ${companyId}::uuid AND m.user_id = ${userId}::uuid
          AND m.starts_at <= now() AND (m.ends_at IS NULL OR m.ends_at > now())
          AND o.permission_code = ${STAFF_GRANT_PERMISSION}
          AND o.effect = 'DENY'
          AND (o.expires_at IS NULL OR o.expires_at > now())
          AND ${systemRoleOverrideAllowedSql('m', 'o', STAFF_GRANT_PERMISSION)}
          AND ${branchScopeCoversSql('o', companyId, businessId, branchId)}
      )
    ) AS allowed`);
  return row?.allowed === true;
}

/** يتحقق أن المالك الداعي لا يزال مالك الشركة الحقيقي ويحمل صلاحية إدارة الدعوات. */
async function ownerAuthorizedForInvitations(
  tx: Tx,
  companyId: string,
  userId: string,
): Promise<boolean> {
  const rows = await tx.execute(sql`
    SELECT 1 FROM memberships m
    WHERE m.company_id = ${companyId}::uuid AND m.user_id = ${userId}::uuid
      AND m.starts_at <= now() AND (m.ends_at IS NULL OR m.ends_at > now())
      AND ${canonicalOwnerSql('m', companyId)}
      AND EXISTS (
        SELECT 1 FROM role_permissions rp
        WHERE rp.role_id = m.role_id AND rp.role_owner_key = m.role_owner_key
          AND rp.permission_code = ${INVITE_MANAGE_PERMISSION}
      )
      AND NOT EXISTS (
        SELECT 1 FROM permission_overrides o
        WHERE o.company_id = m.company_id AND o.membership_id = m.id
          AND o.permission_code = ${INVITE_MANAGE_PERMISSION}
          AND o.effect = 'DENY'
          AND (o.expires_at IS NULL OR o.expires_at > now())
          AND o.scope_type = 'COMPANY' AND o.scope_id = ${companyId}::uuid
      )`);
  return rows.length === 1;
}

/** يتحقق داخل المعاملة من سريان الموظفة والمانح وسجل المنح وصف الرقم المؤقت. */
async function verifyStaffWelcomeInTx(
  tx: Tx,
  companyId: string,
  payload: Extract<OnboardingEmailPayload, { kind: 'staff_welcome_pin' }>,
  operationId: string,
): Promise<boolean> {
  if (!(await companyActive(tx, companyId))) return false;
  const employeeId = payload.employeeId ?? '';
  const [emp] = await tx.execute<{ recovery_email: string | null; deleted_at: unknown }>(sql`
    SELECT recovery_email, deleted_at FROM employees
    WHERE company_id = ${companyId}::uuid AND id = ${employeeId}::uuid`);
  if (emp === undefined || emp.deleted_at !== null) return false;
  if (
    payload.recipient === 'employee' &&
    (emp.recovery_email === null ||
      emp.recovery_email.trim().toLowerCase() !== payload.email.trim().toLowerCase())
  )
    return false;
  const [access] = await tx.execute<{
    state: string;
    attempt_id: string;
    user_id: string | null;
    granted_by: string;
    business_id: string;
    branch_id: string;
  }>(sql`
    SELECT state, attempt_id::text AS attempt_id, user_id::text AS user_id,
      granted_by::text AS granted_by, business_id::text AS business_id, branch_id::text AS branch_id
    FROM employee_staff_access
    WHERE company_id = ${companyId}::uuid AND employee_id = ${employeeId}::uuid`);
  if (
    access === undefined ||
    access.state !== 'ACTIVE' ||
    access.attempt_id !== operationId ||
    access.user_id === null
  )
    return false;
  if (payload.recipient === 'manager') {
    const emailMatches = await matchesMemberContactEmail(
      tx,
      companyId,
      access.granted_by,
      payload.email,
    );
    const authorized =
      emailMatches &&
      (await managerAuthorizedForBranch(
        tx,
        companyId,
        access.granted_by,
        access.business_id,
        access.branch_id,
      ));
    if (!authorized) return false;
  }
  const [pin] = await tx.execute<{ id: string; temporary: boolean }>(sql`
    SELECT id::text AS id, temporary FROM cashier_pins
    WHERE company_id = ${companyId}::uuid AND user_id = ${access.user_id}::uuid`);
  return pin !== undefined && pin.temporary === true && pin.id === payload.pinRevision;
}

/** يتحقق من سريان بريد ترحيب الموظفة: وجود الموظفة، وتطابق بريد المستلم وصلاحية المانح، ومطابقة محاولة المنح السارية. */
async function verifyStaffWelcomeFresh(
  database: Pick<TenantWrappers, 'withTenant'>,
  companyId: string,
  payload: Extract<OnboardingEmailPayload, { kind: 'staff_welcome_pin' }>,
  operationId: string,
): Promise<boolean> {
  if (
    payload.employeeId === undefined ||
    payload.operationId !== operationId ||
    payload.pinRevision === undefined ||
    payload.pinRevision.length === 0
  )
    return false;
  return database.withTenant(companyId, (tx) =>
    verifyStaffWelcomeInTx(tx, companyId, payload, operationId),
  );
}

/** يتحقق من سريان رابط دعوة العضو: الدعوة معلقة وتاريخ إصدارها يطابق المظروف وبريد المالك أو المدعو وصلاحية الداعي سارية. */
async function verifyMemberInvitationFresh(
  database: Pick<TenantWrappers, 'withTenant'>,
  companyId: string,
  payload: Extract<OnboardingEmailPayload, { kind: 'member_invitation' }>,
  operationId: string,
): Promise<boolean> {
  if (
    payload.invitationId === undefined ||
    payload.issuedAt === undefined ||
    payload.invitationId !== operationId
  )
    return false;
  const invitationId = payload.invitationId;
  const issuedAt = payload.issuedAt;
  return database.withTenant(companyId, async (tx) => {
    if (!(await companyActive(tx, companyId))) return false;
    const [inv] = await tx.execute<{
      state: string;
      invited_by: string;
      user_id: string | null;
      issued_match: boolean | null;
    }>(sql`
      SELECT state, invited_by::text AS invited_by, user_id::text AS user_id,
        date_trunc('milliseconds', link_issued_at) = date_trunc('milliseconds', ${issuedAt}::timestamptz) AS issued_match
      FROM member_invitations
      WHERE company_id = ${companyId}::uuid AND id = ${invitationId}::uuid`);
    if (inv === undefined || inv.state !== 'PENDING' || inv.issued_match !== true) return false;
    if (payload.recipient === 'owner') {
      if (!(await matchesMemberContactEmail(tx, companyId, inv.invited_by, payload.email)))
        return false;
      return ownerAuthorizedForInvitations(tx, companyId, inv.invited_by);
    }
    if (inv.user_id !== null) {
      return matchesMemberContactEmail(tx, companyId, inv.user_id, payload.email);
    }
    return true;
  });
}

/**
 * يتأكد قبل الإرسال من حداثة الوجهة وحالة العملية بإغلاق افتراضي: لا يُرسل PIN لعنوان استرجاع
 * تم تعديله أو لمحاولة منح سابقة، ولا رابط دعوة أُبطِل بإعادة الإصدار أو بلا سجل سارٍ.
 *
 * @param database غلافات الشركة لقراءة الجداول تحت RLS
 * @param attempt المحاولة الجارية
 * @param payload الحمولة بعد فك التشفير
 * @param operationId هوية المحاولة أو الدعوة المربوطة بالمظروف
 * @returns true لو قاعدة البيانات والبيانات المرجعية موجودة وسارية
 */
export async function verifyOnboardingRecipientFresh(
  database: Pick<TenantWrappers, 'withTenant'> | undefined,
  attempt: { readonly companyId: string },
  payload: OnboardingEmailPayload,
  operationId: string | null,
): Promise<boolean> {
  if (database === undefined || operationId === null) return false;
  return payload.kind === 'staff_welcome_pin'
    ? verifyStaffWelcomeFresh(database, attempt.companyId, payload, operationId)
    : verifyMemberInvitationFresh(database, attempt.companyId, payload, operationId);
}

/**
 * يشوف إن الوجهة الموقّعة بتاعة المحاولة بتطابق البريد الحقيقي اللي جوا المظروف.
 *
 * @param payload الحمولة بعد فك المظروف
 * @param destination الوجهة الموقّعة المحفوظة في المحاولة
 * @param key مفتاح الختم
 * @returns true لما الوجهة بتطابق
 */
export function onboardingDestinationMatches(
  payload: OnboardingEmailPayload,
  destination: string,
  key: Buffer,
): boolean {
  return onboardingPlaceholderEmail(payload.email, key) === destination;
}

/** يفك مظروف إيميل الترحيب وقت الإرسال: البريد الحقيقي والحمولة، في الذاكرة بس. */
export type OnboardingResolver = (
  attempt: OnboardingEnvelopeAttempt,
) => { readonly email: string; readonly payload: OnboardingEmailPayload } | null;
