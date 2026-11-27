import { and, eq } from 'drizzle-orm';
import {
  authNotificationAttempts as attempts,
  authOtpChallenges as challenges,
} from '../schema/identity-staff-otp.ts';
import type { OtpRuntime } from './staff-otp-runtime.ts';

/**
 * سبب رفض المصالحة: كل حالة بتترجم لسبب ثابت، والسبب بيترجم لحجر في صندوق ردّ المزود.
 */
export type AuthAttemptRefusal =
  'EXECUTION_MISSING' | 'HASH_MISMATCH' | 'PROVIDER_ID_CONFLICT' | 'STATE_INELIGIBLE';

/** مدخلات مصالحة محاولة اعتماد مع ردّ المزود. */
export interface AuthAttemptReconciliation {
  readonly challengeId: string;
  readonly attemptId: string;
  readonly executionId: string;
  /** بصمة المستلم كما حسبها المزود — لازم تطابق بصمة الاعتماد. */
  readonly recipientHash: Uint8Array;
  readonly hashKeyId: string;
  /** بصمة معرّف رسالة المزود — بتتسجل مرة واحدة بس. */
  readonly providerMessageDigest: Uint8Array;
}

/** نتيجة المصالحة: اتسجلت أو اترفضت بسبب محدود. */
export type AuthAttemptReconciliationResult =
  { readonly kind: 'settled' } | { readonly kind: 'refused'; readonly reason: AuthAttemptRefusal };

/**
 * مصالحة محاولة الاعتماد مع ردّ المزود: بتقفل الاعتماد والمحاولة، وبتتأكد إن الردّ بيخصّ
 * المحاولة دي بالظبط (نفس التنفيذ ونفس المستلم)، وبتسجل بصمة رسالة المزود مرة واحدة بس.
 * أي عدم تطابق بيرجّع سبب ثابت من غير أي كتابة.
 */
export interface AuthAttemptFeedbackQueries {
  reconcileAuthAttempt(input: AuthAttemptReconciliation): Promise<AuthAttemptReconciliationResult>;
}

/** المحاولة اللي بتتسوّى لازم تكون SENDING أو SENT، أو FAILED بنتيجة غير معروفة. */
const ELIGIBLE = new Set(['SENDING', 'SENT']);

const reconcile = (
  runtime: OtpRuntime,
  input: AuthAttemptReconciliation,
): Promise<AuthAttemptReconciliationResult> =>
  runtime.run(async (tx) => {
    const [challenge] = await tx
      .select({ hash: challenges.recipientHash, keyId: challenges.hashKeyId })
      .from(challenges)
      .where(eq(challenges.id, input.challengeId));
    if (challenge === undefined) return { kind: 'refused', reason: 'EXECUTION_MISSING' };
    await runtime.lock(tx, challenge.hash);
    const [attempt] = await tx
      .select()
      .from(attempts)
      .where(and(eq(attempts.id, input.attemptId), eq(attempts.challengeId, input.challengeId)))
      .for('update');
    if (attempt === undefined) return { kind: 'refused', reason: 'EXECUTION_MISSING' };
    if (attempt.channel !== 'EMAIL') return { kind: 'refused', reason: 'STATE_INELIGIBLE' };
    if (attempt.executionId !== input.executionId)
      return { kind: 'refused', reason: 'EXECUTION_MISSING' };
    if (
      attempt.hashKeyId !== input.hashKeyId ||
      !Buffer.from(attempt.recipientHash).equals(Buffer.from(input.recipientHash))
    )
      return { kind: 'refused', reason: 'HASH_MISMATCH' };
    const eligible =
      ELIGIBLE.has(attempt.status) ||
      (attempt.status === 'FAILED' && attempt.outcomeKnown === false);
    if (!eligible) return { kind: 'refused', reason: 'STATE_INELIGIBLE' };
    // البصمة بتتسجل مرة واحدة: لو المحاولة ماشية ببصمة مختلفة فالتعارض بيرفض، مش بيكتب.
    if (
      attempt.providerMessageDigest !== null &&
      !Buffer.from(attempt.providerMessageDigest).equals(Buffer.from(input.providerMessageDigest))
    )
      return { kind: 'refused', reason: 'PROVIDER_ID_CONFLICT' };
    // السطر المُنهي ما بيقبلش تعديلاً تانياً (trigger الثبات)، فالبصمة بتتسجل بس والمحاولة
    // لسه ماشية؛ المحاولة المنتهية بتتقارن بس.
    if (attempt.providerMessageDigest === null && attempt.finishedAt === null) {
      const now = await runtime.now(tx);
      await tx
        .update(attempts)
        .set({
          providerMessageDigest: Buffer.from(input.providerMessageDigest),
          updatedAt: now,
        })
        .where(eq(attempts.id, input.attemptId));
    }
    return { kind: 'settled' };
  });

/**
 * يبني حدود مصالحة محاولة الاعتماد على واجهة الهوية المحصورة.
 *
 * @param runtime اتصال الهوية المحدود على pospay_auth
 * @returns المصالحة
 */
export function authAttemptFeedbackQueries(runtime: OtpRuntime): AuthAttemptFeedbackQueries {
  return { reconcileAuthAttempt: (input) => reconcile(runtime, input) };
}
