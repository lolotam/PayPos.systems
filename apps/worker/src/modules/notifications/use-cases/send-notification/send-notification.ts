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
const ADMISSION_RESERVATION_WINDOW_MS = 1000;

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
    const reservedAtMs = await this.reserveAdmission(attempt);
    if (reservedAtMs === null) return;
    const claimed = await this.claimAttempt(attempt, reservedAtMs);
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

  private async reserveAdmission(attempt: Attempt): Promise<number | null> {
    if (await this.admission.reserve(attempt.identity.hash, attempt.deadline)) {
      return this.clock.now().getTime();
    }
    await this.reject(
      attempt,
      refusedResult(
        mayStart(attempt.deadline, this.clock.now()) ? 'ADMISSION_REFUSED' : 'DEADLINE_EXPIRED',
      ),
    );
    return null;
  }

  private buildVerification(
    attempt: Attempt,
    verifyFn: NonNullable<SendConfiguration['verify']>,
    reservedAtMs: number,
    onError: () => void,
    onDecisionTime: (now: Date) => void,
  ): ClaimVerification {
    return {
      rejectEventId: this.ids.newId(),
      decisionTime: () => {
        const current = this.clock.now();
        onDecisionTime(current);
        return current;
      },
      reservationValid: (decisionNow) =>
        decisionNow.getTime() - reservedAtMs < ADMISSION_RESERVATION_WINDOW_MS,
      verify: async (scope) => {
        try {
          return await verifyFn(attempt, scope);
        } catch (error) {
          onError();
          throw error;
        }
      },
    };
  }

  private async claimAttempt(
    attempt: Attempt,
    initialReservedAtMs: number,
  ): Promise<{ readonly executionId: string; readonly now: Date } | null> {
    let reservedAtMs = initialReservedAtMs;
    const verifyFn = this.configuration.verify;
    const needsVerify =
      verifyFn !== undefined && (this.configuration.shouldVerify?.(attempt) ?? true);
    for (let tryCount = 1; ; tryCount += 1) {
      const executionId = this.ids.newId();
      // نفحص الموعد أولاً قبل لمس Redis حتى لا تتعطل نهاية الصلاحية عند تعذر القبول.
      let now = this.clock.now();
      if (!mayStart(attempt.deadline, now)) {
        await this.reject(attempt, refusedResult('DEADLINE_EXPIRED'));
        return null;
      }
      if (tryCount > 1 && now.getTime() - reservedAtMs >= ADMISSION_RESERVATION_WINDOW_MS) {
        const renewedAtMs = await this.reserveAdmission(attempt);
        if (renewedAtMs === null) return null;
        reservedAtMs = renewedAtMs;
        now = this.clock.now();
        if (!mayStart(attempt.deadline, now)) {
          await this.reject(attempt, refusedResult('DEADLINE_EXPIRED'));
          return null;
        }
      }
      let claimNow = now;
      let failedDuringVerify = false;
      const verification = !needsVerify
        ? undefined
        : this.buildVerification(
            attempt,
            verifyFn,
            reservedAtMs,
            () => {
              failedDuringVerify = true;
            },
            (current) => {
              claimNow = current;
            },
          );
      try {
        const claimed = await this.attempts.claim(attempt, executionId, now, verification);
        return claimed ? { executionId, now: claimNow } : null;
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
