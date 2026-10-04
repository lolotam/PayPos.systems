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

/** يصدر تحدياً جديداً للموظف نفسه بعد إثبات QR والأهلية تحت قفل الحضور. */
export class RequestClockChallenge {
  constructor(
    private readonly transactions: AttendanceTransactions,
    private readonly passkeys: AttendancePasskeys,
    private readonly qr: AttendanceScanVerifier,
    private readonly clock: Clock,
  ) {}
  execute(scope: PasskeyScope, scan: AttendanceScan) {
    return this.transactions.run(
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
        const context: AttendanceAssertionScope = {
          ...scope,
          bindingId: tx.context.bindingId,
          bindingRevision: tx.context.bindingRevision,
          passkeyId: tx.context.passkeyId,
          branchId: scan.token.branch_id,
          operation: attendanceTransition(tx.context.open, at) === 'OUT' ? 'CLOCK_OUT' : 'CLOCK_IN',
          qrContext: tx.context.qrContext,
        };
        const generated = await this.passkeys.attendanceOptions(context);
        await tx.storeChallenge(generated.challengeId, context);
        return { challenge_id: generated.challengeId, options: generated.options };
      },
    );
  }
}
