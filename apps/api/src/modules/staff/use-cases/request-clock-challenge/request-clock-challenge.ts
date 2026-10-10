import type { Clock } from '../../../../shared/ports/clock.port.ts';
import type { PasskeyScope } from '../../ports/passkeys.port.ts';
import type {
  AttendanceTransactions,
  AttendancePasskeys,
  AttendanceScanVerifier,
  AttendanceScan,
  AttendanceAssertionScope,
} from '../../ports/clock-attendance.port.ts';
import { attendanceTransition, AttendanceError } from '../../domain/clock-attendance.ts';
import { decidePasskeyDeviceLock, DeviceLockRefusal } from '../../domain/passkey-device-lock.ts';
import type { AttendanceDeviceRefusals } from '../../ports/attendance-device-refusals.port.ts';
import { rethrowDeviceLockRefusal } from '../clock-attendance/device-lock-refusal.ts';

/** يصدر تحدياً جديداً للموظف نفسه بعد إثبات QR والأهلية تحت قفل الحضور. */
export class RequestClockChallenge {
  constructor(
    private readonly transactions: AttendanceTransactions,
    private readonly passkeys: AttendancePasskeys,
    private readonly qr: AttendanceScanVerifier,
    private readonly clock: Clock,
    private readonly refusals: AttendanceDeviceRefusals,
  ) {}
  execute(scope: PasskeyScope, scan: AttendanceScan) {
    return this.transactions
      .run(
        scope,
        scan,
        () => this.clock.now(),
        async (tx, at) => {
          if (
            !(await this.qr.verify(
              scope.companyId,
              scan.token.branch_id,
              scan.token,
              at,
              tx.context.timezone,
            ))
          )
            throw new AttendanceError('BAD_REQUEST');
          if (scan.installation_id !== undefined) {
            const decision = decidePasskeyDeviceLock({
              ...(await tx.deviceLock(scan.installation_id)),
              step: 'CHALLENGE',
            });
            if (decision.kind === 'REFUSE') throw new DeviceLockRefusal(decision, at);
          }
          const context: AttendanceAssertionScope = {
            ...scope,
            bindingId: tx.context.bindingId,
            bindingRevision: tx.context.bindingRevision,
            passkeyId: tx.context.passkeyId,
            branchId: scan.token.branch_id,
            operation:
              attendanceTransition(tx.context.open, at) === 'OUT' ? 'CLOCK_OUT' : 'CLOCK_IN',
            qrContext: tx.context.qrContext,
          };
          const generated = await this.passkeys.attendanceOptions(context);
          await tx.storeChallenge(generated.challengeId, context);
          return { challenge_id: generated.challengeId, options: generated.options };
        },
      )
      .catch((error: unknown) =>
        rethrowDeviceLockRefusal(error, this.refusals, {
          ...scope,
          branchId: scan.token.branch_id,
          step: 'CHALLENGE',
          installationId: scan.installation_id ?? '',
        }),
      );
  }
}
