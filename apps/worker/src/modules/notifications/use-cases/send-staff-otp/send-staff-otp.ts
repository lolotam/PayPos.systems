import type {
  OtpChannel,
  OtpExecution,
  OtpPending,
  OtpResult,
  OtpWait,
  OtpWorkerCapability,
  OtpDiagnostics,
} from '../../ports/otp-execution.port.ts';
import type { SendAdmission } from '../../ports/send-admission.port.ts';
import type { Clock } from '../../ports/clock.port.ts';
import type { IdGenerator } from '../../ports/id-generator.port.ts';
import { otpPollDelay } from '../../domain/otp-wait.ts';

/** يظل التنفيذ نفسه منتظراً PREPARED ثم يرسل مرة واحدة بعد fence معتمد. */
export class SendStaffOtp {
  constructor(
    private readonly auth: OtpExecution,
    private readonly capability: OtpWorkerCapability,
    private readonly admission: SendAdmission,
    private readonly channel: OtpChannel,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
    private readonly wait: OtpWait,
    private readonly diagnostics?: OtpDiagnostics,
  ) {}

  async execute(challengeId: string, attemptId: string): Promise<void> {
    if (!(await this.capability.ready())) {
      this.diagnostics?.record('CAPABILITY_LOST');
      return;
    }
    const attempt = await this.awaitPending(challengeId, attemptId);
    if (attempt === null || attempt.status !== 'PENDING') {
      this.diagnostics?.record('MISSING_OR_TERMINAL');
      return;
    }
    if (this.clock.now() >= attempt.sendDeadline || !this.channel.valid(attempt)) {
      await this.auth.finish(challengeId, attemptId, null, refused('CONFIG_INVALID'));
      return;
    }
    let admitted: boolean;
    try {
      admitted = await this.admission.reserve(attempt.recipientHash, attempt.sendDeadline);
    } catch {
      admitted = false;
    }
    if (!admitted) {
      await this.auth.finish(challengeId, attemptId, null, refused('ADMISSION_REFUSED'));
      return;
    }
    if (!(await this.capability.ready())) return;
    const executionId = this.ids.newId();
    if (!(await this.auth.claim(challengeId, attemptId, executionId))) {
      this.diagnostics?.record('CLAIM_NOT_ACKNOWLEDGED');
      return;
    }
    const material = await this.auth.materialize(challengeId, attemptId, executionId);
    if (
      material === null ||
      this.clock.now() >= material.deadline ||
      !(await this.capability.ready())
    ) {
      await this.auth.finish(challengeId, attemptId, executionId, refused('CHALLENGE_INVALID'));
      return;
    }
    let result: OtpResult;
    try {
      result = await this.channel.send(attempt, material);
    } catch {
      result = { status: 'FAILED', failureCode: 'PROVIDER_UNKNOWN', outcomeKnown: false };
    }
    // النتيجة فقط قابلة لإعادة التسجيل؛ تنفيذ HTTP نفسه لا يعاد أبداً.
    await this.auth.finish(challengeId, attemptId, executionId, result);
  }

  private async awaitPending(challengeId: string, attemptId: string): Promise<OtpPending | null> {
    for (;;) {
      if (!(await this.capability.ready())) return null;
      const row = await this.auth.pending(challengeId, attemptId);
      if (row === null || row.status !== 'PREPARED') return row;
      const delay = otpPollDelay(this.clock.now(), row.preparationDeadline, row.sendDeadline);
      if (delay === 0) {
        const final = await this.auth.timeout(challengeId, attemptId).catch(() => {
          this.diagnostics?.record('PREPARATION_TIMEOUT_PERSISTENCE_FAILED');
          return null;
        });
        return final === 'PENDING' ? this.auth.pending(challengeId, attemptId) : null;
      }
      await this.wait.pause(delay);
    }
  }
}

function refused(failureCode: OtpResult['failureCode']): OtpResult {
  return { status: 'FAILED', failureCode, outcomeKnown: true };
}
