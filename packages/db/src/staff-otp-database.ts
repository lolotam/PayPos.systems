import { and, eq, sql, isNotNull, lte } from 'drizzle-orm';
import {
  authOtpChallenges as challenges,
  authNotificationAttempts as attempts,
} from '../schema/identity-staff-otp.ts';
import { session, user } from '../schema/identity-auth.ts';
import { otpChallenges } from './staff-otp-challenges.ts';
import { otpAttempts } from './staff-otp-attempts.ts';
import { createOtpRuntime, type OtpRuntime } from './staff-otp-runtime.ts';
import { StaffPhoneTakenError, translatingPhoneRace } from './staff-access-database.ts';
import type { OtpDeviceContext } from './staff-otp-types.ts';
import { assertOtpInventory } from './staff-otp-inventory.ts';
import { deleteStaffPrivateViewRows, sweepStaffPrivateViewRows } from './staff-private-view.ts';
import { passwordResetOtpQueries, type CredentialAccountRule } from './password-reset-otp.ts';
import { authAttemptFeedbackQueries } from './auth-attempt-feedback.ts';
import { staffPinResetOtpQueries } from './staff-pin-reset-otp.ts';

/** رفض متوقع: ربط الهاتف مختلف عن المعتمد أو المستخدم غير موجود وقت القفل (#647). */
export class StaffPhoneBindingConflictError extends Error {
  override readonly name = 'StaffPhoneBindingConflictError';
  /** كود ثابت يعبر غلاف الـ runtime كما هو حتى تفرق البوابة بين التعارض وأعطال الاتصال. */
  readonly code = 'OTP_BINDING_REFUSED';
  constructor() {
    super('OTP_BINDING_REFUSED');
  }
}

/** الأهلية الافتراضية لاسترجاع كلمة المرور: أي حساب مش حساب موظف. */
const nonStaffAccount: CredentialAccountRule = (_email, staffAccessOperationId) =>
  staffAccessOperationId === null;

/** وصول عالمي خاص بالاعتماد؛ لا عميل خام ولا بيانات شركة أو جسر. */
export function createStaffOtpDatabase(options: {
  url: string;
  phoneLockKey(hash: Uint8Array): bigint;
  /** قاعدة أهلية استعادة كلمة المرور: حساب الاعتماد غير الموظف. */
  credentialAccount?: CredentialAccountRule;
}) {
  const runtime = createOtpRuntime(options.url, options.phoneLockKey);
  return {
    ...otpChallenges(runtime),
    ...otpAttempts(runtime),
    ...passwordResetOtpQueries(runtime, options.credentialAccount ?? nonStaffAccount),
    ...authAttemptFeedbackQueries(runtime),
    ...staffPinResetOtpQueries(runtime),
    ping: () => otpPing(runtime),
    warm: () => runtime.warm(),
    // الاتصالات مملوكة للعملية المحدودة نفسها، فتغلق في finally قبل عودة نتيجتها.
    close: () => runtime.close(),
    rotate: <T extends { id: string }>(device: OtpDeviceContext, create: () => Promise<T>) =>
      otpRotate(runtime, device, create),
    rotatePersonal: <T extends { id: string }>(userId: string, create: () => Promise<T>) =>
      runtime.run(
        async (tx) => {
          await tx.execute(
            sql`SELECT pg_advisory_xact_lock(hashtextextended(${`pospay:personal-session:v1:${userId}`},0))`,
          );
          const made = await create();
          await tx
            .delete(session)
            .where(
              and(
                eq(session.purpose, 'STAFF_PERSONAL'),
                eq(session.userId, userId),
                sql`${session.id} <> ${made.id}`,
              ),
            );
          return made;
        },
        new Date(Date.now() + 5000),
      ),
    bindingValid: (userId: string, authenticatedAt: Date) =>
      otpBindingValid(runtime, userId, authenticatedAt),
    approvePhone: (input: {
      userId: string;
      phone: string;
      actor: string;
      auditId: string;
      at: Date;
    }) => otpApprovePhone(runtime, input),
    cleanup: (limit: number) => otpCleanup(runtime, limit),
  };
}

/** الربط ما زال صالح: رقم الهاتف موجود ومعتمد قبل وقت المصادقة. */
const otpBindingValid = (runtime: OtpRuntime, userId: string, authenticatedAt: Date) =>
  runtime.run(async (tx) => {
    const [bound] = await tx
      .select({ id: user.id })
      .from(user)
      .where(
        and(
          eq(user.id, userId),
          isNotNull(user.phoneNumber),
          isNotNull(user.phoneBindingApprovedAt),
          lte(user.phoneBindingApprovedAt, authenticatedAt),
        ),
      );
    return bound !== undefined;
  });

export type StaffOtpDatabase = ReturnType<typeof createStaffOtpDatabase>;

const otpPing = async (runtime: ReturnType<typeof createOtpRuntime>) => {
  await runtime.run((tx) => assertOtpInventory(tx), new Date(Date.now() + 1000));
  await runtime.warm();
};

const otpRotate = async <T extends { id: string }>(
  runtime: ReturnType<typeof createOtpRuntime>,
  device: OtpDeviceContext,
  create: () => Promise<T>,
) =>
  runtime.run(
    async (tx) => {
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(hashtextextended(${`pospay:staff-session:v1:${device.deviceId}`},0))`,
      );
      const made = await create();
      const removed = await tx
        .delete(session)
        .where(
          and(
            eq(session.purpose, 'STAFF_POS'),
            sql`${session.staffDeviceContext}->>'deviceId' = ${device.deviceId}`,
            sql`${session.id} <> ${made.id}`,
          ),
        )
        .returning({ id: session.id });
      await deleteStaffPrivateViewRows(
        tx,
        removed.map((row) => row.id),
      );
      return made;
    },
    new Date(Date.now() + 5000),
  );

type ApprovePhoneInput = {
  userId: string;
  phone: string;
  actor: string;
  auditId: string;
  at: Date;
};
type OtpTx = Parameters<Parameters<ReturnType<typeof createOtpRuntime>['run']>[0]>[0];

async function applyPhoneApproval(tx: OtpTx, input: ApprovePhoneInput): Promise<void> {
  await tx
    .update(challenges)
    .set({ status: 'SUPERSEDED', codeMac: null, finishedAt: input.at, updatedAt: input.at })
    .where(and(eq(challenges.userId, input.userId), eq(challenges.status, 'ACTIVE')));
  const removed = await tx
    .delete(session)
    .where(
      and(
        eq(session.userId, input.userId),
        sql`${session.purpose} IN ('STAFF_POS','STAFF_PERSONAL')`,
      ),
    )
    .returning({ id: session.id });
  await deleteStaffPrivateViewRows(
    tx,
    removed.map((row) => row.id),
  );
  await translatingPhoneRace(() =>
    tx
      .update(user)
      .set({ phoneNumber: input.phone, phoneNumberVerified: false })
      .where(eq(user.id, input.userId)),
  );
  await tx.update(user).set({ phoneBindingApprovedAt: input.at }).where(eq(user.id, input.userId));
  await tx.execute(sql`INSERT INTO platform_audit_log(id,actor,action,target_user_id,details)
      VALUES(${input.auditId},${input.actor},'phone.binding_approved',${input.userId},'{}'::jsonb)`);
}

const otpApprovePhone = async (
  runtime: ReturnType<typeof createOtpRuntime>,
  input: ApprovePhoneInput,
): Promise<'approved' | 'unchanged'> => {
  try {
    return await runtime.run(async (tx) => {
      const existing = await tx
        .select({ hash: challenges.recipientHash })
        .from(challenges)
        .where(and(eq(challenges.userId, input.userId), eq(challenges.status, 'ACTIVE')))
        .orderBy(challenges.recipientHash, challenges.id);
      for (const row of existing) await runtime.lock(tx, row.hash);
      const [bound] = await tx
        .select({
          id: user.id,
          phone: user.phoneNumber,
          approvedAt: user.phoneBindingApprovedAt,
        })
        .from(user)
        .where(eq(user.id, input.userId))
        .for('update');
      if (bound === undefined) throw new StaffPhoneBindingConflictError();
      // بعد قفل صف المستخدم: رفض تغيير الهاتف لهاتف مختلف أو تنازع هاتف مملوك لمستخدم آخر (#647).
      if (bound.phone !== null && bound.phone !== input.phone) {
        throw new StaffPhoneBindingConflictError();
      }
      const [taken] = await tx
        .select({ id: user.id })
        .from(user)
        .where(and(eq(user.phoneNumber, input.phone), sql`${user.id} <> ${input.userId}`))
        .limit(1);
      if (taken !== undefined) throw new StaffPhoneTakenError();
      // لو الهاتف نفسه معتمداً بالفعل وقت القفل، نرجع unchanged بلا أي أثر جانبي على الجلسات أو التحديات.
      if (bound.phone === input.phone && bound.approvedAt !== null) {
        return 'unchanged';
      }
      await applyPhoneApproval(tx, input);
      return 'approved';
    });
  } catch (error) {
    if (error instanceof Error && error.message === 'OTP_DATABASE_UNAVAILABLE_STAFF_PHONE_TAKEN') {
      throw new StaffPhoneTakenError();
    }
    if (
      error instanceof Error &&
      error.message === 'OTP_DATABASE_UNAVAILABLE_OTP_BINDING_REFUSED'
    ) {
      throw new StaffPhoneBindingConflictError();
    }
    throw error;
  }
};

const otpCleanup = async (runtime: ReturnType<typeof createOtpRuntime>, limit: number) => {
  if (!Number.isInteger(limit) || limit < 1 || limit > 100)
    throw new Error('OTP_RETENTION_INVALID');
  const removed = await runtime.run(
    async (tx) => {
      const expired = await tx
        .select({ id: challenges.id, hash: challenges.recipientHash })
        .from(challenges)
        .where(
          sql`${challenges.expiresAt} <= clock_timestamp() AND ${challenges.status} = 'ACTIVE'`,
        )
        .orderBy(challenges.recipientHash, challenges.id)
        .limit(limit);
      for (const row of expired) {
        const now = await runtime.lock(tx, row.hash);
        await tx
          .update(challenges)
          .set({ status: 'EXPIRED', codeMac: null, finishedAt: now, updatedAt: now })
          .where(and(eq(challenges.id, row.id), eq(challenges.status, 'ACTIVE')));
      }
      const old = await tx
        .select({ id: challenges.id })
        .from(challenges)
        .where(
          sql`
        ${challenges.expiresAt} < clock_timestamp() - interval '30 days'
        AND NOT EXISTS(SELECT 1 FROM auth_notification_attempts a WHERE a.challenge_id = ${challenges.id} AND a.status = 'SENDING')`,
        )
        .orderBy(challenges.expiresAt, challenges.id)
        .limit(limit);
      for (const row of old) {
        await tx.delete(attempts).where(eq(attempts.challengeId, row.id));
        await tx.delete(challenges).where(eq(challenges.id, row.id));
      }
      return old.length;
    },
    new Date(Date.now() + 1000),
  );
  // مسح صفوف العرض الخاص في معاملة محدودة مستقلة حتى لا يلغي تعثرها تنظيف تحديات OTP (#776).
  await runtime.run(
    async (tx) => {
      await sweepStaffPrivateViewRows(tx, limit);
    },
    new Date(Date.now() + 1000),
  );
  return removed;
};
