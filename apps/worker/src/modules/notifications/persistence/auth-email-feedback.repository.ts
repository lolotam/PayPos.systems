import type { AuthAttemptReconciliation, AuthAttemptReconciliationResult } from '@pospay/db';
import type {
  EmailFeedbackAuthInput,
  EmailFeedbackAuthOutcome,
  EmailFeedbackAuthRepository,
} from '../ports/email-feedback.port.ts';

/**
 * واجهة المصالحة المحصورة لسجل الاعتماد. بتتبعت من جذر التركيب (apps/worker/src/main.ts)
 * — موديول الإشعارات نفسه ما بيستوردش facade قاعدة الهوية (ADR-0019).
 */
export interface AuthAttemptReconciler {
  /**
   * يربط ردّ المزود بالمحاولة ويقفل التعارض في البصمة.
   *
   * @param input المحاولة والوسوم وبصمة المزود
   */
  reconcileAuthAttempt(input: AuthAttemptReconciliation): Promise<AuthAttemptReconciliationResult>;
}

/**
 * مهايئ المصالحة: يترجم سبب الرفض الثابت من سجل الاعتماد إلى سبب التعطيل نفسه.
 *
 * @param reconciler الواجهة المحصورة من جذر التركيب
 * @returns مستودع المصالحة
 */
export function createAuthEmailFeedbackRepository(
  reconciler: AuthAttemptReconciler,
): EmailFeedbackAuthRepository {
  return {
    reconcile: async (input: EmailFeedbackAuthInput): Promise<EmailFeedbackAuthOutcome> => {
      const result = await reconciler.reconcileAuthAttempt({
        challengeId: input.challengeId,
        attemptId: input.attemptId,
        executionId: input.executionId,
        recipientHash: input.recipientHash,
        hashKeyId: input.hashKeyId,
        providerMessageDigest: input.providerMessageDigest,
      });
      if (result.kind === 'refused') return { ok: false, reason: result.reason };
      return { ok: true, bound: true };
    },
  };
}
