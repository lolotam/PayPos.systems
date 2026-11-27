import { and, eq, sql } from 'drizzle-orm';
import { authOtpChallenges as challenges } from '../schema/identity-staff-otp.ts';
import {
  lockedChallenge,
  MAX_FAILED_ATTEMPTS,
  verifyOtpChallenge,
  type ChallengeScope,
  type PasswordResetCheck,
} from './otp-challenge-verify.ts';
import type { OtpRuntime } from './staff-otp-runtime.ts';
import type { OtpChallengeRecord, OtpContext } from './staff-otp-types.ts';

/** سياق اعتماد استرجاع الرقم السري: الجهاز والفرع والقناة اللي طلب منها الاعتماد. */
export type StaffPinResetContext = Extract<OtpContext, { purpose: 'STAFF_PIN_RESET' }>;

/** صاحب الاعتماد المستهلك وبصمة مستلمه — الكتابة على الرقم السري بتتأكد منهما تحت قفل الشركة. */
export interface StaffPinResetConsumed {
  readonly userId: string;
  readonly recipientHash: Buffer;
}

/** استهلاك اعتماد الاسترجاع: المقارنة ثابتة الزمن على نفس الجهاز اللي طلب الكود. */
export interface StaffPinResetConsumption {
  readonly challengeId: string;
  readonly device: StaffPinResetContext;
  compare(challenge: OtpChallengeRecord): boolean;
}

/**
 * حدود اعتماد استرجاع الرقم السري على pospay_auth: الفحص والاستهلاك وسجل المنصة، من غير أي
 * وصول لجداول الشركة. الكتابة على الرقم نفسه بتتم بره الحزمة تحت withTenant.
 */
export interface StaffPinResetOtpQueries {
  /**
   * يفحص الكود على اعتماد استرجاع من نفس الجهاز: الخطأ بيزوّد المحاولات والخامسة بتنهي الاعتماد.
   *
   * @param challengeId معرّف الاعتماد
   * @param device الجهاز المتحقق الذي يقدّم الكود
   * @param compare مقارنة ثابتة الزمن لبصمة الكود
   * @param auditId معرّف سجل المنصة عند الاستنفاد
   * @param deadline موعد النافذة الثابتة
   */
  verifyStaffPinResetOtp(
    challengeId: string,
    device: StaffPinResetContext,
    compare: (challenge: OtpChallengeRecord) => boolean,
    auditId: string,
    deadline?: Date,
  ): Promise<PasswordResetCheck>;
  /**
   * يستهلك الاعتماد مرة واحدة تحت قفل المستلم وصف الاعتماد: بيرجع صاحبه وبصمة مستلمه، أو null
   * لو غير نشط أو منتهي أو من جهاز تاني أو الكود لا يطابق. الكتابة اللي بعده بتتم بمعاملة الشركة.
   */
  consumeStaffPinResetOtp(input: StaffPinResetConsumption): Promise<StaffPinResetConsumed | null>;
  /**
   * يكتب سجل المنصة بإتمام الاسترجاع بعد نجاح كتابة الرقم، من غير أي سر.
   *
   * @param auditId معرّف السجل
   * @param userId صاحب الرقم
   */
  recordStaffPinReset(auditId: string, userId: string): Promise<void>;
}

const sameDevice = (context: OtpContext, device: StaffPinResetContext): boolean =>
  JSON.stringify(Object.entries(context).sort()) === JSON.stringify(Object.entries(device).sort());

const scopeOf = (device: StaffPinResetContext): ChallengeScope => ({
  accepts: (context) => sameDevice(context, device),
  exhaustedAction: 'staffpin.reset_exhausted',
});

const consume = (runtime: OtpRuntime, input: StaffPinResetConsumption) =>
  runtime.run(async (tx): Promise<StaffPinResetConsumed | null> => {
    const found = await lockedChallenge(runtime, tx, input.challengeId);
    if (found === null) return null;
    const row = found.challenge;
    if (row.status !== 'ACTIVE' || row.userId === null) return null;
    if (!sameDevice(row.deviceContext, input.device)) return null;
    if (found.now >= row.expiresAt) {
      await tx
        .update(challenges)
        .set({ status: 'EXPIRED', codeMac: null, finishedAt: found.now, updatedAt: found.now })
        .where(and(eq(challenges.id, input.challengeId), eq(challenges.status, 'ACTIVE')));
      return null;
    }
    if (row.failedAttempts >= MAX_FAILED_ATTEMPTS || !input.compare(row)) return null;
    await tx
      .update(challenges)
      .set({
        status: 'CONSUMED',
        codeMac: null,
        consumedAt: found.now,
        finishedAt: found.now,
        updatedAt: found.now,
      })
      .where(and(eq(challenges.id, input.challengeId), eq(challenges.status, 'ACTIVE')));
    return { userId: row.userId, recipientHash: row.recipientHash };
  });

/**
 * يبني حدود استرجاع الرقم السري على واجهة الهوية المحصورة.
 *
 * @param runtime اتصال الهوية المحدود على pospay_auth
 * @returns الفحص والاستهلاك وسجل المنصة
 */
export function staffPinResetOtpQueries(runtime: OtpRuntime): StaffPinResetOtpQueries {
  return {
    verifyStaffPinResetOtp: (challengeId, device, compare, auditId, deadline) =>
      verifyOtpChallenge(runtime, scopeOf(device), challengeId, compare, auditId, deadline),
    consumeStaffPinResetOtp: (input) => consume(runtime, input),
    recordStaffPinReset: (auditId, userId) =>
      runtime.run(async (tx) => {
        await tx.execute(sql`INSERT INTO platform_audit_log(id,actor,action,target_user_id,details)
          VALUES(${auditId},${userId},'staffpin.reset_completed',${userId},'{}'::jsonb)`);
      }),
  };
}
