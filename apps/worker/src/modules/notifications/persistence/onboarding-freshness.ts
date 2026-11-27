import {
  canonicalOwnerSql,
  systemRoleGrantAllowedSql,
  systemRoleOverrideAllowedSql,
  type TenantWrappers,
  type Tx,
} from '@pospay/db';
import { canonicalEmail, type OnboardingEmailPayload } from '@pospay/notifications';
import { sql } from 'drizzle-orm';

const STAFF_GRANT_PERMISSION = 'manage:staff-access:branch';
const INVITE_MANAGE_PERMISSION = 'manage:memberships:company';

/** يطابق البريدين بتطبيع النطاق فقط كما يحافظ المظروف والمرسِل على حالة الاسم المحلي. */
function sameCanonicalEmail(actual: string | null | undefined, expected: string): boolean {
  if (actual == null) return false;
  const left = canonicalEmail(actual);
  const right = canonicalEmail(expected);
  return left !== null && right !== null && left === right;
}

/** يقفل الشركة النشطة قفلاً مشتركاً لمنع تداخل الحذف الناعم مع التحقق والـ claim. */
async function companyActive(tx: Tx, companyId: string): Promise<boolean> {
  const rows = await tx.execute(sql`
    SELECT 1 FROM companies WHERE id = ${companyId}::uuid AND deleted_at IS NULL FOR SHARE`);
  return rows.length === 1;
}

/** يقفل عضويات واستثناءات المدير المانح قفلاً مشتركاً قبل قفل الموظفة وسجل الدخول. */
async function lockStaffManagerActors(
  tx: Tx,
  companyId: string,
  employeeId: string,
): Promise<void> {
  await tx.execute(sql`
    SELECT m.id FROM memberships m
    WHERE m.company_id = ${companyId}::uuid
      AND m.user_id = (
        SELECT esa.granted_by FROM employee_staff_access esa
        WHERE esa.company_id = ${companyId}::uuid AND esa.employee_id = ${employeeId}::uuid
      )
    ORDER BY m.id FOR SHARE`);
  await tx.execute(sql`
    SELECT o.id FROM permission_overrides o
    WHERE o.company_id = ${companyId}::uuid
      AND o.membership_id IN (
        SELECT m.id FROM memberships m
        WHERE m.company_id = ${companyId}::uuid
          AND m.user_id = (
            SELECT esa.granted_by FROM employee_staff_access esa
            WHERE esa.company_id = ${companyId}::uuid AND esa.employee_id = ${employeeId}::uuid
          )
      )
    ORDER BY o.id FOR SHARE`);
}

/** يقفل عضويات واستثناءات الداعي والمدعو قفلاً مشتركاً قبل قفل صف الدعوة. */
async function lockInvitationActors(
  tx: Tx,
  companyId: string,
  invitationId: string,
): Promise<void> {
  await tx.execute(sql`
    SELECT m.id FROM memberships m
    WHERE m.company_id = ${companyId}::uuid
      AND m.user_id IN (
        SELECT mi.invited_by FROM member_invitations mi
        WHERE mi.company_id = ${companyId}::uuid AND mi.id = ${invitationId}::uuid
        UNION
        SELECT mi.user_id FROM member_invitations mi
        WHERE mi.company_id = ${companyId}::uuid AND mi.id = ${invitationId}::uuid
          AND mi.user_id IS NOT NULL
      )
    ORDER BY m.id FOR SHARE`);
  await tx.execute(sql`
    SELECT o.id FROM permission_overrides o
    WHERE o.company_id = ${companyId}::uuid
      AND o.membership_id IN (
        SELECT m.id FROM memberships m
        WHERE m.company_id = ${companyId}::uuid
          AND m.user_id IN (
            SELECT mi.invited_by FROM member_invitations mi
            WHERE mi.company_id = ${companyId}::uuid AND mi.id = ${invitationId}::uuid
            UNION
            SELECT mi.user_id FROM member_invitations mi
            WHERE mi.company_id = ${companyId}::uuid AND mi.id = ${invitationId}::uuid
              AND mi.user_id IS NOT NULL
          )
      )
    ORDER BY o.id FOR SHARE`);
}

/** يلتقط طابع قاعدة البيانات الفعلي بعد انتظار أقفال الصفوف حتى لا تتقادم فحوص النوافذ الزمنية. */
async function postLockTimestamp(tx: Tx): Promise<string> {
  const [row] = await tx.execute<{ checked_at: string | Date }>(
    sql`SELECT clock_timestamp() AS checked_at`,
  );
  if (row?.checked_at === undefined) throw new Error('CLOCK_TIMESTAMP_MISSING');
  return new Date(row.checked_at).toISOString();
}

/** يطابق البريد المختوم مع جهة الاتصال الحية للعضو داخل الشركة عبر القراءة المحدودة. */
async function matchesMemberContactEmail(
  tx: Tx,
  companyId: string,
  userId: string,
  expectedEmail: string,
  checkedAt: string,
): Promise<boolean> {
  const [contact] = await tx.execute<{ email: string | null }>(sql`
    SELECT email FROM public.team_alert_recipient_contacts(
      ${companyId}::uuid,
      ARRAY[${userId}::uuid],
      ${checkedAt}::timestamptz,
      false
    )
    WHERE user_id = ${userId}::uuid`);
  return sameCanonicalEmail(contact?.email, expectedEmail);
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
  checkedAt: string,
): Promise<boolean> {
  const [row] = await tx.execute<{ allowed: boolean | null }>(sql`
    SELECT (
      EXISTS (
        SELECT 1 FROM memberships m
        JOIN role_permissions rp ON rp.role_id = m.role_id AND rp.role_owner_key = m.role_owner_key
        WHERE m.company_id = ${companyId}::uuid AND m.user_id = ${userId}::uuid
          AND m.starts_at <= ${checkedAt}::timestamptz AND (m.ends_at IS NULL OR m.ends_at > ${checkedAt}::timestamptz)
          AND rp.permission_code = ${STAFF_GRANT_PERMISSION}
          AND ${systemRoleGrantAllowedSql('m', 'rp')}
          AND ${branchScopeCoversSql('m', companyId, businessId, branchId)}
      )
      OR EXISTS (
        SELECT 1 FROM permission_overrides o
        JOIN memberships m ON m.company_id = o.company_id AND m.id = o.membership_id
        WHERE m.company_id = ${companyId}::uuid AND m.user_id = ${userId}::uuid
          AND m.starts_at <= ${checkedAt}::timestamptz AND (m.ends_at IS NULL OR m.ends_at > ${checkedAt}::timestamptz)
          AND o.permission_code = ${STAFF_GRANT_PERMISSION}
          AND o.effect = 'ALLOW'
          AND (o.expires_at IS NULL OR o.expires_at > ${checkedAt}::timestamptz)
          AND ${systemRoleOverrideAllowedSql('m', 'o', STAFF_GRANT_PERMISSION)}
          AND ${branchScopeCoversSql('o', companyId, businessId, branchId)}
      )
    ) AND (
      EXISTS (
        SELECT 1 FROM memberships om
        WHERE om.company_id = ${companyId}::uuid AND om.user_id = ${userId}::uuid
          AND om.starts_at <= ${checkedAt}::timestamptz AND (om.ends_at IS NULL OR om.ends_at > ${checkedAt}::timestamptz)
          AND ${canonicalOwnerSql('om', companyId)}
      )
      OR NOT EXISTS (
        SELECT 1 FROM permission_overrides o
        JOIN memberships m ON m.company_id = o.company_id AND m.id = o.membership_id
        WHERE m.company_id = ${companyId}::uuid AND m.user_id = ${userId}::uuid
          AND m.starts_at <= ${checkedAt}::timestamptz AND (m.ends_at IS NULL OR m.ends_at > ${checkedAt}::timestamptz)
          AND o.permission_code = ${STAFF_GRANT_PERMISSION}
          AND o.effect = 'DENY'
          AND (o.expires_at IS NULL OR o.expires_at > ${checkedAt}::timestamptz)
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
  checkedAt: string,
): Promise<boolean> {
  const rows = await tx.execute(sql`
    SELECT 1 FROM memberships m
    WHERE m.company_id = ${companyId}::uuid AND m.user_id = ${userId}::uuid
      AND m.starts_at <= ${checkedAt}::timestamptz AND (m.ends_at IS NULL OR m.ends_at > ${checkedAt}::timestamptz)
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
          AND (o.expires_at IS NULL OR o.expires_at > ${checkedAt}::timestamptz)
          AND o.scope_type = 'COMPANY' AND o.scope_id = ${companyId}::uuid
      )`);
  return rows.length === 1;
}

/** يتحقق داخل المعاملة من سريان الموظفة والمانح وسجل المنح وصف الرقم المؤقت تحت أقفال مشتركة. */
async function verifyStaffWelcomeInTx(
  tx: Tx,
  companyId: string,
  payload: Extract<OnboardingEmailPayload, { kind: 'staff_welcome_pin' }>,
  operationId: string,
): Promise<boolean> {
  if (!(await companyActive(tx, companyId))) return false;
  const employeeId = payload.employeeId ?? '';
  if (payload.recipient === 'manager') await lockStaffManagerActors(tx, companyId, employeeId);
  const [emp] = await tx.execute<{ recovery_email: string | null; deleted_at: unknown }>(sql`
    SELECT recovery_email, deleted_at FROM employees
    WHERE company_id = ${companyId}::uuid AND id = ${employeeId}::uuid FOR SHARE`);
  if (emp === undefined || emp.deleted_at !== null) return false;
  if (payload.recipient === 'employee' && !sameCanonicalEmail(emp.recovery_email, payload.email))
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
    WHERE company_id = ${companyId}::uuid AND employee_id = ${employeeId}::uuid FOR SHARE`);
  if (
    access === undefined ||
    access.state !== 'ACTIVE' ||
    access.attempt_id !== operationId ||
    access.user_id === null
  )
    return false;
  if (payload.recipient === 'manager') {
    const checkedAt = await postLockTimestamp(tx);
    const emailMatches = await matchesMemberContactEmail(
      tx,
      companyId,
      access.granted_by,
      payload.email,
      checkedAt,
    );
    const authorized =
      emailMatches &&
      (await managerAuthorizedForBranch(
        tx,
        companyId,
        access.granted_by,
        access.business_id,
        access.branch_id,
        checkedAt,
      ));
    if (!authorized) return false;
  }
  const [pin] = await tx.execute<{ id: string; temporary: boolean }>(sql`
    SELECT id::text AS id, temporary FROM cashier_pins
    WHERE company_id = ${companyId}::uuid AND user_id = ${access.user_id}::uuid FOR SHARE`);
  return pin !== undefined && pin.temporary === true && pin.id === payload.pinRevision;
}

/** يتحقق داخل المعاملة من سريان الدعوة وبريد وصلاحية الداعي أو عضوية المدعو تحت أقفال مشتركة. */
async function verifyMemberInvitationInTx(
  tx: Tx,
  companyId: string,
  payload: Extract<OnboardingEmailPayload, { kind: 'member_invitation' }>,
  invitationId: string,
  issuedAt: string,
): Promise<boolean> {
  if (!(await companyActive(tx, companyId))) return false;
  await lockInvitationActors(tx, companyId, invitationId);
  const [inv] = await tx.execute<{
    state: string;
    invited_by: string;
    user_id: string | null;
    membership_id: string | null;
    issued_match: boolean | null;
  }>(sql`
    SELECT state, invited_by::text AS invited_by, user_id::text AS user_id,
      membership_id::text AS membership_id,
      date_trunc('milliseconds', link_issued_at) = date_trunc('milliseconds', ${issuedAt}::timestamptz) AS issued_match
    FROM member_invitations
    WHERE company_id = ${companyId}::uuid AND id = ${invitationId}::uuid FOR SHARE`);
  const checkedAt = await postLockTimestamp(tx);
  if (
    inv === undefined ||
    inv.state !== 'PENDING' ||
    inv.issued_match !== true ||
    inv.user_id === null ||
    inv.membership_id === null
  )
    return false;
  const activeRows = await tx.execute(sql`
    SELECT 1 FROM memberships
    WHERE company_id = ${companyId}::uuid
      AND (id = ${inv.membership_id}::uuid OR user_id = ${inv.user_id}::uuid)
      AND starts_at <= ${checkedAt}::timestamptz AND (ends_at IS NULL OR ends_at > ${checkedAt}::timestamptz)
    LIMIT 1`);
  if (activeRows.length === 0) return false;
  if (payload.recipient === 'owner') {
    if (!(await matchesMemberContactEmail(tx, companyId, inv.invited_by, payload.email, checkedAt)))
      return false;
    return ownerAuthorizedForInvitations(tx, companyId, inv.invited_by, checkedAt);
  }
  return matchesMemberContactEmail(tx, companyId, inv.user_id, payload.email, checkedAt);
}

/**
 * يتأكد قبل الإرسال من حداثة الوجهة وحالة العملية بإغلاق افتراضي تحت أقفال القراءة المشتركة:
 * لا يُرسل PIN لعنوان مستلم تغيّر أو لصلاحية انتهت، ولا رابط دعوة أُبطِل أو بلا حساب وعضوية سارية.
 *
 * @param database غلافات الشركة لقراءة الجداول تحت RLS داخل معاملة الـ claim
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
  if (payload.kind === 'staff_welcome_pin') {
    if (
      payload.employeeId === undefined ||
      payload.operationId !== operationId ||
      payload.pinRevision === undefined ||
      payload.pinRevision.length === 0
    )
      return false;
    return database.withTenant(attempt.companyId, (tx) =>
      verifyStaffWelcomeInTx(tx, attempt.companyId, payload, operationId),
    );
  }
  if (
    payload.invitationId === undefined ||
    payload.issuedAt === undefined ||
    payload.invitationId !== operationId
  )
    return false;
  const invitationId = payload.invitationId;
  const issuedAt = payload.issuedAt;
  return database.withTenant(attempt.companyId, (tx) =>
    verifyMemberInvitationInTx(tx, attempt.companyId, payload, invitationId, issuedAt),
  );
}
