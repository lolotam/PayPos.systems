import type { TenantWrappers } from '@pospay/db';
import {
  extractOnboardingOperationId,
  MEMBER_INVITATION_KEY,
  onboardingPlaceholderEmail,
  STAFF_WELCOME_PIN_KEY,
  unsealOnboardingEmailEnvelope,
  type OnboardingEmailPayload,
} from '@pospay/notifications';
import { sql } from 'drizzle-orm';

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

/** يتحقق من سريان بريد ترحيب الموظفة: وجود الموظفة، تطابق بريد الاستعادة عند اللزوم، ومطابقة محاولة المنح السارية. */
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
  const employeeId = payload.employeeId;
  const pinRevision = payload.pinRevision;
  return database.withTenant(companyId, async (tx) => {
    if (payload.recipient === 'employee') {
      const [emp] = await tx.execute<{ recovery_email: string | null; deleted_at: unknown }>(sql`
        SELECT recovery_email, deleted_at FROM employees
        WHERE company_id = ${companyId}::uuid AND id = ${employeeId}::uuid`);
      if (
        emp === undefined ||
        emp.deleted_at !== null ||
        emp.recovery_email === null ||
        emp.recovery_email.trim().toLowerCase() !== payload.email.trim().toLowerCase()
      )
        return false;
    }
    const [access] = await tx.execute<{
      state: string;
      attempt_id: string;
      user_id: string | null;
    }>(sql`
      SELECT state, attempt_id::text AS attempt_id, user_id::text AS user_id FROM employee_staff_access
      WHERE company_id = ${companyId}::uuid AND employee_id = ${employeeId}::uuid`);
    if (
      access === undefined ||
      access.state !== 'ACTIVE' ||
      access.attempt_id !== operationId ||
      access.user_id === null
    )
      return false;
    const [pin] = await tx.execute<{ id: string; temporary: boolean }>(sql`
      SELECT id::text AS id, temporary FROM cashier_pins
      WHERE company_id = ${companyId}::uuid AND user_id = ${access.user_id}::uuid`);
    return pin !== undefined && pin.temporary === true && pin.id === pinRevision;
  });
}

/** يتحقق من سريان رابط دعوة العضو: الدعوة ما زالت معلقة وتاريخ إصدارها يطابق المظروف. */
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
    const [inv] = await tx.execute<{ state: string; issued_match: boolean | null }>(sql`
      SELECT state,
        date_trunc('milliseconds', link_issued_at) = date_trunc('milliseconds', ${issuedAt}::timestamptz) AS issued_match
      FROM member_invitations
      WHERE company_id = ${companyId}::uuid AND id = ${invitationId}::uuid`);
    return inv !== undefined && inv.state === 'PENDING' && inv.issued_match === true;
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
