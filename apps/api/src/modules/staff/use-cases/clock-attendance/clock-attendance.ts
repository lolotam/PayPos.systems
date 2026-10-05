import type { Clock } from '../../../../shared/ports/clock.port.ts';
import type { IdGenerator } from '../../../../shared/ports/id-generator.port.ts';
import type { PasskeyScope } from '../../ports/passkeys.port.ts';
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
  attendanceWorkingDate,
  attendanceGeofence,
  attendanceSchedule,
  attendanceLateMinutes,
  attendanceMissedDeadline,
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
    return this.transactions.run(
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
          return this.apply(tx, at, input.installation_id);
        }),
    );
  }
  private async apply(
    tx: AttendanceTransaction,
    at: Date,
    installationId: string,
  ): Promise<ClockResult> {
    const context = tx.context;
    const transition = attendanceTransition(context.open, at);
    const workingDate = attendanceWorkingDate(at, context.timezone);
    const schedule = attendanceSchedule(context.shifts, at, workingDate);
    const geo = attendanceGeofence(context.location, context.geo);
    const closing = transition === 'OUT';
    const result: ClockResult = {
      session_id: closing && context.open !== null ? context.open.id : this.ids.newId(),
      operation: closing ? 'CLOCK_OUT' : 'CLOCK_IN',
      working_date: closing && context.open !== null ? context.open.workingDate : workingDate,
      accepted_at: at.toISOString(),
      exceptions: geo === 'OK' ? [] : [geo],
      late_minutes:
        closing && context.open !== null
          ? context.open.lateMinutes
          : attendanceLateMinutes(schedule?.startsAt ?? null, at),
      missed_session_id:
        transition === 'MISSED_IN' && context.open !== null ? context.open.id : null,
    };
    await tx.persist({
      result,
      geo,
      at,
      schedule,
      open: context.open,
      closeAt:
        context.open === null
          ? null
          : transition === 'MISSED_IN'
            ? attendanceMissedDeadline(context.open)
            : at,
      // إشارة واحدة لكل مسح مقبول: dedupe والإعادة المخزنة والرفض لا تصل إلى persist أصلاً.
      installationId,
    });
    return result;
  }
}
