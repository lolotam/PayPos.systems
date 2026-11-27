import { AsyncLocalStorage } from 'node:async_hooks';
import type { TenantWrappers, Tx } from '@pospay/db';
import { sql } from 'drizzle-orm';

import { transactionWriters } from '../../../shared/adapters/transaction-writers.ts';
import type { OnboardingEmailSealer } from '../../../shared/ports/onboarding-email.port.ts';
import {
  planStaffWelcomePinNotice,
  type StaffWelcomeRecipientSpec,
} from '../domain/staff-access.ts';
import type { GrantCommitScope, GrantEmployeeAccessSteps } from '../ports/staff-access.port.ts';
import type {
  StaffWelcomePinCommand,
  StaffWelcomePinContextPort,
} from '../ports/staff-access-commit.port.ts';
import { readStaffMemberEmailContacts } from './attendance-change-alert-rule.adapter.ts';

type CommitPayload = Parameters<GrantCommitScope['appendEvent']>[0];
type CommitInputArg = Parameters<GrantEmployeeAccessSteps['commit']>[1];
type CommitActorArg = Parameters<GrantEmployeeAccessSteps['commit']>[0];

/** حالة طلب المنح الجاري: الرقم السري المؤقت من الأمر فقط، ثم حالة المعاملة الثالثة داخلها. */
interface WelcomePinSlot {
  readonly command: StaffWelcomePinCommand;
  commit?: {
    readonly actor: CommitActorArg;
    readonly input: CommitInputArg;
    operationId: string | null;
    granted: CommitPayload | null;
  };
}

const welcomePinSlot = new AsyncLocalStorage<WelcomePinSlot>();

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
 * يقرأ نسخة الرقم السري المؤقت السارية للموظفة داخل نفس معاملة المنح لربط مظروف البريد بها.
 *
 * @param tx        معاملة الشركة
 * @param companyId الشركة
 * @param userId    مستخدم الموظفة الممنوحة
 * @returns معرّف صف الرقم المؤقت، أو null عند غيابه
 */
async function readTemporaryPinRevision(
  tx: Tx,
  companyId: string,
  userId: string,
): Promise<string | null> {
  const rows = await tx.execute<{ id: string }>(sql`
    SELECT id::text AS id FROM cashier_pins
    WHERE company_id = ${companyId}::uuid AND user_id = ${userId}::uuid AND temporary = true`);
  return rows[0]?.id ?? null;
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
  recipients: readonly StaffWelcomeRecipientSpec[],
  command: StaffWelcomePinCommand,
  operationId: string,
  pinRevision: string,
  role: string,
  expiresAt: Date,
  sealer: OnboardingEmailSealer,
): WelcomeNotificationRecipient[] {
  const result: WelcomeNotificationRecipient[] = [];
  for (const recipient of recipients) {
    const sealed = sealer.sealStaffWelcomePin({
      companyId: command.companyId,
      operationId,
      email: recipient.email,
      payload: {
        kind: 'staff_welcome_pin',
        email: recipient.email,
        pin: command.pin,
        role,
        recipient: recipient.recipient,
        targetMaskedEmail: recipient.targetMaskedEmail,
        employeeId: command.employeeId,
        operationId,
        pinRevision,
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
 * بريد ترحيب الموظفة: حدث واحد في الـ outbox باستخدام نفس وقت وصلاحية الرقم المؤقت وهوية العملية المقفولة.
 *
 * @param tx          معاملة الخطوة الثالثة
 * @param command     أمر إعطاء الدخول
 * @param input       مدخلات الخطوة الثالثة (الساعة ومولّد المعرّفات)
 * @param operationId معرّف العملية المقفول في الخطوة الثالثة
 * @param payload     حمولة حدث المنح المعتمدة من scope.appendEvent
 * @param sealer      ختم إيميلات الترحيب
 */
async function appendStaffWelcomePin(
  tx: Tx,
  command: StaffWelcomePinCommand,
  input: CommitInputArg,
  operationId: string,
  payload: CommitPayload,
  sealer: OnboardingEmailSealer,
  pinExpiresAt: (at: Date) => Date,
): Promise<void> {
  const contacts = await readStaffMemberEmailContacts(
    tx,
    command.companyId,
    [command.userId],
    input.at,
  );
  const pinRevision = await readTemporaryPinRevision(tx, command.companyId, payload.userId);
  if (pinRevision === null) return;
  const recoveryEmail = await readEmployeeRecoveryEmail(tx, command.companyId, command.employeeId);
  const plan = planStaffWelcomePinNotice({
    expiresAt: pinExpiresAt(input.at),
    managerEmail: contacts.get(command.userId)?.email ?? null,
    recoveryEmail,
    mask: sealer.mask,
  });
  if (plan.recipients.length === 0) return;
  const notificationRecipients = sealWelcomeRecipients(
    plan.recipients,
    command,
    operationId,
    pinRevision,
    payload.role,
    plan.expiresAt,
    sealer,
  );
  if (notificationRecipients.length === 0) return;
  await transactionWriters(tx, input.ids).outbox.append({
    aggregateType: 'employee',
    aggregateId: command.employeeId,
    eventType: 'StaffWelcomePinNoticeRequested',
    payload: {
      business_id: command.businessId,
      branch_id: payload.branchId,
      notification_recipients: notificationRecipients,
    },
  });
}

/** يلتقط هوية العملية وحمولة الحدث المعتمد من الخطوة الثالثة بلا تعديل على خطوات المنح. */
function wrapGrantCommit(innerSteps: GrantEmployeeAccessSteps): GrantEmployeeAccessSteps {
  return {
    begin: innerSteps.begin,
    commit: (actor, input, work) => {
      const slot = welcomePinSlot.getStore();
      if (slot === undefined) return innerSteps.commit(actor, input, work);
      const commitState: NonNullable<WelcomePinSlot['commit']> = {
        actor,
        input,
        operationId: null,
        granted: null,
      };
      return welcomePinSlot.run({ command: slot.command, commit: commitState }, () =>
        innerSteps.commit(actor, input, (scope) =>
          work({
            ...scope,
            recheck: async () => {
              const rechecked = await scope.recheck();
              commitState.operationId = rechecked.record?.attemptId ?? null;
              return rechecked;
            },
            appendEvent: async (payload) => {
              await scope.appendEvent(payload);
              commitState.granted = payload;
            },
          }),
        ),
      );
    },
  };
}

/**
 * يبني ربط بريد الترحيب فوق خطوات المنح: يحقن معاملة الخطوة الثالثة بساعة المنح وهوية العملية
 * المقفولة بدون أي تعديل على `grant-employee-access.ts` أو `staff-access.adapter.ts` (تجنب تداخل 080-b).
 *
 * @param database     غلافات الشركة الأصلية
 * @param sealer       ختم إيميلات الترحيب، أو undefined عند التعطيل
 * @param pinExpiresAt دالة حساب انتهاء الرقم المؤقت المحقونة من جذر التركيب
 * @param buildSteps   دالة بناء خطوات المنح فوق غلاف قاعدة البيانات
 * @returns الغلاف والمنفذ الجاهزان لحقن مزوّد المنح
 */
export function createStaffWelcomeBinding(
  database: TenantWrappers,
  sealer: OnboardingEmailSealer | undefined,
  pinExpiresAt: ((at: Date) => Date) | undefined,
  buildSteps: (db: TenantWrappers) => GrantEmployeeAccessSteps,
): {
  readonly steps: GrantEmployeeAccessSteps;
  readonly welcome: StaffWelcomePinContextPort;
} {
  const welcome: StaffWelcomePinContextPort = {
    runWithPin: (command, work) => welcomePinSlot.run({ command }, work),
  };
  if (sealer === undefined || pinExpiresAt === undefined) {
    return { steps: buildSteps(database), welcome };
  }
  const wrappedDb: TenantWrappers = {
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
          const slot = welcomePinSlot.getStore();
          const commit = slot?.commit;
          if (slot !== undefined && commit?.granted != null && commit.operationId !== null) {
            await appendStaffWelcomePin(
              tx,
              slot.command,
              commit.input,
              commit.operationId,
              commit.granted,
              sealer,
              pinExpiresAt,
            );
          }
          return outcome;
        },
        options,
      ),
  };
  return { welcome, steps: wrapGrantCommit(buildSteps(wrappedDb)) };
}
