import { refusedResult, type Attempt, type TerminalResult } from '../../domain/attempt-status.ts';
import { mayStart } from '../../domain/send-deadline.ts';
import type { AttemptsRepository, ClaimVerification } from '../../ports/attempts.repository.ts';
import type {
  ChannelPort,
  DestinationIdentity,
  SendConfiguration,
} from '../../ports/channel.port.ts';
import type { Clock } from '../../ports/clock.port.ts';
import type { IdGenerator } from '../../ports/id-generator.port.ts';
import type { SendAdmission } from '../../ports/send-admission.port.ts';

const MAX_PRECLAIM_VERIFY_ATTEMPTS = 3;

function isPreClaimVerifyError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'preClaimVerifyFailed' in error &&
    (error as { preClaimVerifyFailed?: unknown }).preClaimVerifyFailed === true
  );
}

/** ينفذ الإذن بعد COMMIT مؤكد، ويسجل النتيجة بسياج يمنع إعادة تقديم الطلب. */
export class SendNotification {
  constructor(
    readonly attempts: AttemptsRepository,
    readonly channel: ChannelPort,
    readonly admission: SendAdmission,
    readonly identity: DestinationIdentity,
    readonly configuration: SendConfiguration,
    readonly clock: Clock,
    readonly ids: IdGenerator,
  ) {}

  async execute(companyId: string, attemptId: string): Promise<void> {
    let attempt = await this.attempts.pending(companyId, attemptId);
    if (attempt === null) return;
    const refusal = this.preflight(attempt);
    if (refusal !== null) {
      await this.reject(attempt, refusal);
      return;
    }
    if (!(await this.admission.reserve(attempt.identity.hash, attempt.deadline))) {
      await this.reject(
        attempt,
        refusedResult(
          mayStart(attempt.deadline, this.clock.now()) ? 'ADMISSION_REFUSED' : 'DEADLINE_EXPIRED',
        ),
      );
      return;
    }
    const claimed = await this.claimAttempt(attempt);
    if (claimed === null) return;
    attempt = {
      ...attempt,
      status: 'SENDING',
      executionId: claimed.executionId,
      sendingAt: claimed.now,
    };
    try {
      const result = await this.channel.send(attempt);
      await this.recordResult(attempt, result);
    } finally {
      Object.assign(attempt, { phone: null, email: null });
    }
  }

  private async claimAttempt(
    attempt: Attempt,
  ): Promise<{ readonly executionId: string; readonly now: Date } | null> {
    const verifyFn = this.configuration.verify;
    for (let tryCount = 1; ; tryCount += 1) {
      // نفس اللحظة للفحص وللـ claim: لو اتحسبوا مرتين، الموعد ممكن يعدّي بينهم والـ claim يترفض في صمت،
      // فالمحاولة تفضل PENDING ومعاها الرقم ومن غير نتيجة EXPIRED.
      const executionId = this.ids.newId();
      const now = this.clock.now();
      if (!mayStart(attempt.deadline, now)) {
        await this.reject(attempt, refusedResult('DEADLINE_EXPIRED'));
        return null;
      }
      let failedDuringVerify = false;
      const verification: ClaimVerification | undefined =
        verifyFn === undefined
          ? undefined
          : {
              rejectEventId: this.ids.newId(),
              verify: async (scope) => {
                try {
                  return await verifyFn(attempt, scope);
                } catch (error) {
                  failedDuringVerify = true;
                  throw error;
                }
              },
            };
      try {
        const claimed = await this.attempts.claim(attempt, executionId, now, verification);
        return claimed ? { executionId, now } : null;
      } catch (error) {
        const canRetry =
          (failedDuringVerify || isPreClaimVerifyError(error)) &&
          !(error instanceof Error && error.name === 'CommitOutcomeUnknownError');
        if (!canRetry || tryCount >= MAX_PRECLAIM_VERIFY_ATTEMPTS) throw error;
      }
    }
  }

  private preflight(attempt: Attempt): TerminalResult | null {
    if (!mayStart(attempt.deadline, this.clock.now())) return refusedResult('DEADLINE_EXPIRED');
    const destination = attempt.channel === 'email' ? attempt.email : attempt.phone;
    if (destination == null || !this.identity.matches(destination, attempt.identity, attempt))
      return refusedResult('DESTINATION_INVALID');
    const failure = this.configuration.failure(attempt);
    return failure === null ? null : refusedResult(failure);
  }

  private reject(attempt: Attempt, result: TerminalResult): Promise<boolean> {
    return this.attempts.finishPending(attempt, result, this.ids.newId(), this.clock.now());
  }

  private async recordResult(attempt: Attempt, result: TerminalResult): Promise<void> {
    const eventId = this.ids.newId();
    const now = this.clock.now();
    try {
      await this.attempts.finish(attempt, result, eventId, now);
    } catch {
      try {
        await this.attempts.finish(attempt, result, eventId, now);
      } catch {
        await this.attempts.finish(attempt, result, eventId, now);
      }
    }
  }
}
