import { and, eq, sql } from 'drizzle-orm';
import { authOtpChallenges as challenges } from '../schema/identity-staff-otp.ts';
import type { OtpRuntime } from './staff-otp-runtime.ts';
import type { OtpChallengeRecord, OtpContext } from './staff-otp-types.ts';
import type { Tx } from './with-tenant.ts';

/** أقصى عدد محاولات فاشلة قبل ما الاعتماد ينتهي. */
export const MAX_FAILED_ATTEMPTS = 5;

/** نتيجة فحص الاعتماد قبل أي كتابة: مطابق أو مرفوض أو مستنفد. */
export type PasswordResetCheck = 'MATCH' | 'INVALID' | 'EXHAUSTED';

/** قفل الاعتماد وقراءة صفه تحت المستلم نفسه. */
export async function lockedChallenge(
  runtime: OtpRuntime,
  tx: Tx,
  challengeId: string,
): Promise<{ challenge: OtpChallengeRecord; now: Date } | null> {
  const [hint] = await tx
    .select({ hash: challenges.recipientHash })
    .from(challenges)
    .where(eq(challenges.id, challengeId));
  if (hint === undefined) return null;
  const now = await runtime.lock(tx, hint.hash);
  const [row] = await tx
    .select()
    .from(challenges)
    .where(eq(challenges.id, challengeId))
    .for('update');
  if (row === undefined) return null;
  return { challenge: { ...row, deviceContext: row.deviceContext as OtpContext }, now };
}

/** يحدد أي سياق اعتماد يقبله الفحص، واسم سجل المنصة عند الاستنفاد. */
export interface ChallengeScope {
  accepts(context: OtpContext): boolean;
  readonly exhaustedAction: string;
}

export const passwordResetScope: ChallengeScope = {
  accepts: (context) => (context as { purpose?: string }).purpose === 'PASSWORD_RESET',
  exhaustedAction: 'reset.exhausted',
};

/** يفحص الكود على الاعتماد النشط؛ الخطأ بيزوّد المحاولات والخامسة بتنهيه. */
export const verifyOtpChallenge = (
  runtime: OtpRuntime,
  scope: ChallengeScope,
  challengeId: string,
  compare: (challenge: OtpChallengeRecord) => boolean,
  auditId: string,
  deadline?: Date,
): Promise<PasswordResetCheck> =>
  runtime.run(async (tx) => {
    const found = await lockedChallenge(runtime, tx, challengeId);
    if (found === null) return 'INVALID';
    const row = found.challenge;
    // اعتماد من غرض تاني ما ينفعش يتزوّد عدّاده ولا يتنهي من هنا.
    if (!scope.accepts(row.deviceContext)) return 'INVALID';
    if (row.status !== 'ACTIVE') return 'INVALID';
    if (found.now >= row.expiresAt) {
      await tx
        .update(challenges)
        .set({ status: 'EXPIRED', codeMac: null, finishedAt: found.now, updatedAt: found.now })
        .where(and(eq(challenges.id, challengeId), eq(challenges.status, 'ACTIVE')));
      return 'INVALID';
    }
    if (row.failedAttempts >= MAX_FAILED_ATTEMPTS) return 'EXHAUSTED';
    if (compare(row)) return 'MATCH';
    const failedAttempts = row.failedAttempts + 1;
    const exhausted = failedAttempts >= MAX_FAILED_ATTEMPTS;
    await tx
      .update(challenges)
      .set({
        status: exhausted ? 'EXHAUSTED' : 'ACTIVE',
        failedAttempts,
        codeMac: exhausted ? null : row.codeMac,
        finishedAt: exhausted ? found.now : null,
        updatedAt: found.now,
      })
      .where(and(eq(challenges.id, challengeId), eq(challenges.status, 'ACTIVE')));
    if (exhausted)
      await tx.execute(sql`INSERT INTO platform_audit_log(id,actor,action,target_user_id,details)
          VALUES(${auditId},${row.userId ?? 'anonymous'},${scope.exhaustedAction},${row.userId},'{}'::jsonb)`);
    return exhausted ? 'EXHAUSTED' : 'INVALID';
  }, deadline);
