import type { Clock } from '../../../../shared/ports/clock.port.ts';
import type { IdGenerator } from '../../../../shared/ports/id-generator.port.ts';
import type { PasskeyScope } from '../../ports/passkeys.port.ts';
import { decidePasskeyDeviceLock, DeviceLockRefusal } from '../../domain/passkey-device-lock.ts';
import type { AttendanceDeviceRefusals } from '../../ports/attendance-device-refusals.port.ts';
import { rethrowDeviceLockRefusal } from './device-lock-refusal.ts';
import type {
  AttendanceTransactions,
  AttendancePasskeys,
  AttendanceScanVerifier,
  AttendanceScan,
  AttendanceAssertion,
  AttendanceTransaction,
} from '../../ports/clock-attendance.port.ts';
import {
  attendanceDuplicate,
  attendanceTransition,
  planAttendance,
  AttendanceError,
  type ClockResult,
} from '../../domain/clock-attendance.ts';

export { AttendanceError } from '../../domain/clock-attendance.ts';

/** كل حركة تتطلب UV جديداً؛ القفل والرد والتدقيق والأحداث لا تنفصل عن commit واحد. */
export class ClockAttendance {
  constructor(
    private readonly transactions: AttendanceTransactions,
    private readonly passkeys: AttendancePasskeys,
    private readonly qr: AttendanceScanVerifier,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
    private readonly refusals: AttendanceDeviceRefusals,
  ) {}
  execute(
    scope: PasskeyScope,
    input: AttendanceScan & {
      challenge_id: string;
      response: AttendanceAssertion;
      installation_id: string;
    },
    idem: { key: string; fingerprint: string },
  ): Promise<ClockResult> {
    return this.transactions
      .run(
        scope,
        input,
        () => this.clock.now(),
        (tx, at) =>
          tx.idempotent(idem.key, idem.fingerprint, async () => {
            const challenge = await tx.challenge(input.challenge_id);
            if (challenge === null) throw new AttendanceError('PASSKEY_INVALID');
            if (
              !(await this.qr.verify(
                scope.companyId,
                input.token.branch_id,
                input.token,
                at,
                tx.context.timezone,
              ))
            )
              throw new AttendanceError('BAD_REQUEST');
            const decision = decidePasskeyDeviceLock({
              ...(await tx.deviceLock(input.installation_id)),
              step: 'CLOCK',
            });
            if (decision.kind === 'REFUSE') throw new DeviceLockRefusal(decision, at);
            const proof = await this.passkeys.verifyAttendance(
              challenge,
              input.challenge_id,
              input.response,
            );
            if (proof === null || !proof.consume(challenge))
              throw new AttendanceError('PASSKEY_INVALID');
            const duplicate = attendanceDuplicate(tx.context.lastAt, tx.context.lastResult, at);
            if (duplicate !== null) return duplicate;
            const operation =
              attendanceTransition(tx.context.open, at) === 'OUT' ? 'CLOCK_OUT' : 'CLOCK_IN';
            if (challenge.operation !== operation) throw new AttendanceError('PASSKEY_INVALID');
            return this.apply(tx, at, input.installation_id, decision.attach);
          }),
      )
      .catch((error: unknown) =>
        rethrowDeviceLockRefusal(error, this.refusals, {
          ...scope,
          branchId: input.token.branch_id,
          step: 'CLOCK',
          installationId: input.installation_id,
        }),
      );
  }
  private async apply(
    tx: AttendanceTransaction,
    at: Date,
    installationId: string,
    attachInstallation: boolean,
  ): Promise<ClockResult> {
    const context = tx.context;
    const plan = planAttendance(
      {
        open: context.open,
        timezone: context.timezone,
        shifts: context.shifts,
        location: context.location,
        geo: context.geo,
        source: 'QR',
      },
      at,
      attendanceTransition(context.open, at) === 'OUT' && context.open !== null
        ? context.open.id
        : this.ids.newId(),
    );
    await tx.persist({
      result: plan.result,
      geo: plan.geo,
      at,
      schedule: plan.schedule,
      open: context.open,
      closeAt: plan.closeAt,
      // إشارة واحدة لكل مسح مقبول: dedupe والإعادة المخزنة والرفض لا تصل إلى persist أصلاً.
      installationId,
      attachInstallation,
    });
    return plan.result;
  }
}
