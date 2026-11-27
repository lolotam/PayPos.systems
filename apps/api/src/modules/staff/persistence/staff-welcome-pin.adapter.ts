import { AsyncLocalStorage } from 'node:async_hooks';
import type { IdGenerator, TenantWrappers, Tx } from '@pospay/db';
import { sql } from 'drizzle-orm';

import { transactionWriters } from '../../../shared/adapters/transaction-writers.ts';
import type { Clock } from '../../../shared/ports/clock.port.ts';
import type { OnboardingEmailSealer } from '../../../shared/ports/onboarding-email.port.ts';
import { readStaffMemberEmailContacts } from './attendance-change-alert-rule.adapter.ts';

/** عمر الرقم السري المؤقت في بريد الترحيب — نفس مدة الرقم في identity (قرار D4، FR-F2-1). */
const STAFF_WELCOME_PIN_TTL_MS = 24 * 60 * 60 * 1000;

/** اللي بريد الترحيب بيحتاجه من أمر إعطاء الدخول. */
export interface StaffWelcomeCommand {
  readonly companyId: string;
  readonly businessId: string;
  readonly employeeId: string;
  readonly userId: string;
  readonly pin: string;
}

/** سياق الطلب الجاري: الأمر والساعة، بينتقل مع الاستدعاءات غير المتزامنة. */
interface StaffWelcomeContext {
  readonly command: StaffWelcomeCommand;
  readonly clock: Clock;
}

const welcomeContext = new AsyncLocalStorage<StaffWelcomeContext>();

/** مستلم بريد ترحيب: إيميله الحقيقي ودوره في الرسالة. */
interface StaffWelcomeRecipient {
  readonly email: string;
  readonly recipient: 'manager' | 'employee';
  readonly targetMaskedEmail: string | null;
}

/**
 * يشغّل شغل الطلب جوّه سياق بريد الترحيب؛ السياق بيتنقل مع الاستدعاءات غير المتزامنة.
 *
 * @param context الأمر والساعة
 * @param work    شغل الطلب
 * @returns نتيجة الشغل
 */
export function runWithStaffWelcomeContext<T>(
  context: StaffWelcomeContext,
  work: () => Promise<T>,
): Promise<T> {
  return welcomeContext.run(context, work);
}

/**
 * بريد استرجاع الموظفة: الإيميل الاختياري بتاع الموظفة نفسها، مش بريد حساب الدخول.
 *
 * @param tx         معاملة الشركة
 * @param companyId  الشركة
 * @param employeeId الموظفة
 * @returns الإيميل، أو null
 */
async function readEmployeeRecoveryEmail(
  tx: Tx,
  companyId: string,
  employeeId: string,
): Promise<string | null> {
  const rows = await tx.execute<{ recovery_email: string | null }>(sql`
    SELECT recovery_email FROM employees
    WHERE company_id = ${companyId}::uuid AND id = ${employeeId}::uuid AND deleted_at IS NULL`);
  return rows[0]?.recovery_email ?? null;
}

/**
 * مستلمو بريد الترحيب: المدير اللي منح، والموظفة لو عندها إيميل استرجاع؛ من غير تكرار.
 *
 * @param tx         معاملة الشركة
 * @param companyId  الشركة
 * @param command    أمر إعطاء الدخول
 * @param at         لحظة الإصدار
 * @param sealer     ختم إيميلات الترحيب
 * @returns المستلمون، أو قائمة فاضية
 */
async function welcomeRecipients(
  tx: Tx,
  companyId: string,
  command: StaffWelcomeCommand,
  at: Date,
  sealer: OnboardingEmailSealer,
): Promise<readonly StaffWelcomeRecipient[]> {
  const contacts = await readStaffMemberEmailContacts(tx, companyId, [command.userId], at);
  const managerEmail = contacts.get(command.userId)?.email ?? null;
  const recoveryEmail = await readEmployeeRecoveryEmail(tx, companyId, command.employeeId);
  const recipients: StaffWelcomeRecipient[] = [];
  if (managerEmail !== null)
    recipients.push({
      email: managerEmail,
      recipient: 'manager',
      targetMaskedEmail: recoveryEmail === null ? null : sealer.mask(recoveryEmail),
    });
  if (
    recoveryEmail !== null &&
    recoveryEmail.trim().toLowerCase() !== managerEmail?.trim().toLowerCase()
  )
    recipients.push({ email: recoveryEmail, recipient: 'employee', targetMaskedEmail: null });
  return recipients;
}

/**
 * نتيجة الخطوة الثالثة:.email مانح بس، وبها الدور والفرع.
 *
 * @param outcome نتيجة الخطوة
 * @returns true لما الطلب اتمنح
 */
function isGrantedOutcome(
  outcome: unknown,
): outcome is { readonly kind: 'granted'; readonly role: string; readonly branchId: string } {
  if (typeof outcome !== 'object' || outcome === null) return false;
  const granted = outcome as { kind?: unknown; role?: unknown; branchId?: unknown };
  return (
    granted.kind === 'granted' &&
    typeof granted.role === 'string' &&
    typeof granted.branchId === 'string'
  );
}

type WelcomeNotificationRecipient = {
  readonly channel: 'email';
  readonly email: string;
  readonly locale: string;
  readonly template_key: string;
  readonly template_revision: number;
  readonly safe_parameters: readonly {
    readonly name: string;
    readonly type: 'text';
    readonly value: string;
  }[];
  readonly send_deadline: string;
};

/** يختم مستلمي بريد الترحيب في مظاريف صالحة للـ outbox من غير أي نص صريح. */
function sealWelcomeRecipients(
  recipients: readonly StaffWelcomeRecipient[],
  command: StaffWelcomeCommand,
  role: string,
  expiresAt: Date,
  sealer: OnboardingEmailSealer,
): WelcomeNotificationRecipient[] {
  const result: WelcomeNotificationRecipient[] = [];
  for (const recipient of recipients) {
    const sealed = sealer.sealStaffWelcomePin({
      companyId: command.companyId,
      email: recipient.email,
      payload: {
        kind: 'staff_welcome_pin',
        email: recipient.email,
        pin: command.pin,
        role,
        recipient: recipient.recipient,
        targetMaskedEmail: recipient.targetMaskedEmail,
        expiresAt: expiresAt.toISOString(),
        expiresAtMs: expiresAt.getTime(),
      },
    });
    if (sealed === null) continue;
    result.push({
      channel: 'email',
      email: sealed.placeholderEmail,
      locale: 'ar',
      template_key: sealed.template.key,
      template_revision: sealed.template.revision,
      safe_parameters: sealed.parameters,
      send_deadline: expiresAt.toISOString(),
    });
  }
  return result;
}

/**
 * بريد ترحيب الموظفة: حدث واحد في الـ outbox، بمظروف مشفّر لكل مستلم، ونص صريح مفيش.
 *
 * @param tx        معاملة الخطوة الثالثة
 * @param ids       مولّد المعرّفات
 * @param command   أمر إعطاء الدخول
 * @param outcome   نتيجة الخطوة الثالثة
 * @param at        لحظة الإصدار
 * @param sealer    ختم إيميلات الترحيب
 */
async function appendStaffWelcomePin(
  tx: Tx,
  ids: IdGenerator,
  command: StaffWelcomeCommand,
  outcome: { readonly role: string; readonly branchId: string },
  at: Date,
  sealer: OnboardingEmailSealer,
): Promise<void> {
  const recipients = await welcomeRecipients(tx, command.companyId, command, at, sealer);
  if (recipients.length === 0) return;
  const expiresAt = new Date(at.getTime() + STAFF_WELCOME_PIN_TTL_MS);
  const notificationRecipients = sealWelcomeRecipients(
    recipients,
    command,
    outcome.role,
    expiresAt,
    sealer,
  );
  if (notificationRecipients.length === 0) return;
  await transactionWriters(tx, ids).outbox.append({
    aggregateType: 'employee',
    aggregateId: command.employeeId,
    eventType: 'StaffWelcomePinNoticeRequested',
    payload: {
      business_id: command.businessId,
      branch_id: outcome.branchId,
      notification_recipients: notificationRecipients,
    },
  });
}

/**
 * غلاف معاملات الشركة: بعد ما الخطوة الثالثة تمنح الدخول، بريد الترحيب بيتكتب في نفس المعاملة.
 * من غير ختم صالح مفيش بريد خالص — والمنح نفسه ما بيقفش.
 *
 * @param database غلافات الشركة
 * @param sealer   ختم إيميلات الترحيب
 * @param ids      مولّد المعرّفات
 * @returns الغلافات مع خطوة الترحيب
 */
export function createStaffWelcomePinDatabase(
  database: TenantWrappers,
  sealer: OnboardingEmailSealer | undefined,
  ids: IdGenerator,
): TenantWrappers {
  if (sealer === undefined) return database;
  return {
    ...database,
    withTenant: <T>(
      companyId: string,
      work: (tx: Tx) => Promise<T>,
      options?: Parameters<TenantWrappers['withTenant']>[2],
    ): Promise<T> =>
      database.withTenant(
        companyId,
        async (tx) => {
          const outcome = await work(tx);
          const context = welcomeContext.getStore();
          if (context === undefined || !isGrantedOutcome(outcome)) return outcome;
          const at = context.clock.now();
          await appendStaffWelcomePin(tx, ids, context.command, outcome, at, sealer);
          return outcome;
        },
        options,
      ),
  };
}
