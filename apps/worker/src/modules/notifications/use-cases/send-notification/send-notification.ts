import { refusedResult, type Attempt, type TerminalResult } from '../../domain/attempt-status.ts';
import { mayStart } from '../../domain/send-deadline.ts';
import type { AttemptsRepository } from '../../ports/attempts.repository.ts';
import type {
  ChannelPort,
  DestinationIdentity,
  SendConfiguration,
} from '../../ports/channel.port.ts';
import type { Clock } from '../../ports/clock.port.ts';
import type { IdGenerator } from '../../ports/id-generator.port.ts';
import type { SendAdmission } from '../../ports/send-admission.port.ts';

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
    // نفس اللحظة للفحص وللـ claim: لو اتحسبوا مرتين، الموعد ممكن يعدّي بينهم والـ claim يترفض في صمت،
    // فالمحاولة تفضل PENDING ومعاها الرقم ومن غير نتيجة EXPIRED.
    const executionId = this.ids.newId();
    const now = this.clock.now();
    if (!mayStart(attempt.deadline, now)) {
      await this.reject(attempt, refusedResult('DEADLINE_EXPIRED'));
      return;
    }
    if (!(await this.attempts.claim(attempt, executionId, now))) return;
    attempt = { ...attempt, status: 'SENDING', executionId, sendingAt: now };
    try {
      const result = await this.channel.send(attempt);
      await this.recordResult(attempt, result);
    } finally {
      Object.assign(attempt, { phone: null, email: null });
    }
  }

  private preflight(attempt: Attempt): TerminalResult | null {
    if (!mayStart(attempt.deadline, this.clock.now())) return refusedResult('DEADLINE_EXPIRED');
    const destination = attempt.channel === 'email' ? attempt.email : attempt.phone;
    if (destination == null || !this.identity.matches(destination, attempt.identity))
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
