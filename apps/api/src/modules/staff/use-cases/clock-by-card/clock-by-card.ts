import type { Clock } from '../../../../shared/ports/clock.port.ts';
import type { IdGenerator } from '../../../../shared/ports/id-generator.port.ts';
import {
  AttendanceError,
  attendanceDuplicate,
  planAttendance,
  type ClockResult,
} from '../../domain/clock-attendance.ts';
import { normalizeCardCode, validCardCode } from '../../domain/employee-card.ts';
import type {
  CardClockScope,
  CardClockTransaction,
  CardClockTransactions,
  CardClockWrite,
} from '../../ports/clock-by-card.port.ts';
import {
  CardScanAttemptsUnavailableError,
  type CardScanAttemptDecision,
  type CardScanAttempts,
} from '../../ports/card-scan-attempts.port.ts';

export { AttendanceError } from '../../domain/clock-attendance.ts';
export { CardScanAttemptsUnavailableError };

/** تجاوز حد المسحات الفاشلة؛ طبقة HTTP ترجعه 429 قبل أي بحث عن الكارت، مع الثواني الباقية في الشباك. */
export class CardScanLimitedError extends Error {
  constructor(readonly remaining: number) {
    super('CARD_SCAN_LIMITED');
  }
}

/** يبلّغ جذر التركيب أن علامة اكتمال المسح لم تُحفظ بعد كتابة الحركة. لا يحمل الكود. */
export type CardScanCompletionWarning = (companyId: string, deviceId: string) => void;

/** الحركة بالكارت مدخل ثانٍ لنفس دومين spec 027؛ المسح الفاشل فقط يُحتسب، وفقدان علامة الاكتمال لا يُسقط الحركة. */
export class ClockByCard {
  constructor(
    private readonly transactions: CardClockTransactions,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
    private readonly attempts: CardScanAttempts,
    private readonly warn: CardScanCompletionWarning,
  ) {}
  execute(
    scope: CardClockScope,
    input: { card_code: string },
    idem: { key: string; fingerprint: string },
  ): Promise<ClockResult> {
    return this.finish(scope, input.card_code, idem);
  }
  private async finish(
    scope: CardClockScope,
    cardCode: string,
    idem: { key: string; fingerprint: string },
  ): Promise<ClockResult> {
    // نفس المفتاح والبصمة المربوطة بالجهاز والعامل تُعاد قبل السقف، حتى لو ضاع مؤشر Redis.
    const stored = await this.transactions.completed(scope, idem);
    if (stored !== null) return stored;
    const decision = await this.gate(scope, idem);
    const code = normalizeCardCode(cardCode);
    // رفض الشكل يُحتسب قبل أي بحث؛ إعادة المفتاح المكتمل لا تعيد التحقق.
    if (decision.outcome === 'open' && !validCardCode(code)) {
      await this.attempts.recordFailure(scope.companyId, scope.deviceId);
      throw new AttendanceError('BAD_REQUEST');
    }
    try {
      const result = await this.transactions.run(
        scope,
        code,
        () => this.clock.now(),
        (tx, at) => this.effect(tx, at, idem),
      );
      if (decision.outcome === 'open') await this.markCompleted(scope, idem);
      return result;
    } catch (error) {
      if (decision.outcome === 'open' && failedCardScan(error)) {
        await this.attempts.recordFailure(scope.companyId, scope.deviceId);
      }
      throw error;
    }
  }
  private async gate(
    scope: CardClockScope,
    idem: { key: string; fingerprint: string },
  ): Promise<CardScanAttemptDecision> {
    const decision = await this.attempts.inspect(
      scope.companyId,
      scope.deviceId,
      idem.key,
      idem.fingerprint,
    );
    if (decision.outcome === 'limited') throw new CardScanLimitedError(decision.remaining);
    return decision;
  }
  private async markCompleted(
    scope: CardClockScope,
    idem: { key: string; fingerprint: string },
  ): Promise<void> {
    try {
      await this.attempts.complete(scope.companyId, scope.deviceId, idem.key, idem.fingerprint);
    } catch (error) {
      // الحركة مكتوبة. 503 هنا يدفع العميل لمفتاح جديد فيُسجَّل حضور ثانٍ.
      if (!(error instanceof CardScanAttemptsUnavailableError)) throw error;
      this.warn(scope.companyId, scope.deviceId);
    }
  }
  private effect(
    tx: CardClockTransaction,
    at: Date,
    idem: { key: string; fingerprint: string },
  ): Promise<ClockResult> {
    return tx.idempotent(idem.key, idem.fingerprint, async () => {
      await tx.confirmOperator();
      const duplicate = attendanceDuplicate(tx.context.lastAt, tx.context.lastResult, at);
      if (duplicate !== null) return duplicate;
      return this.apply(tx, at);
    });
  }
  private async apply(tx: CardClockTransaction, at: Date): Promise<ClockResult> {
    const context = tx.context;
    const plan = planAttendance(
      {
        open: context.open,
        timezone: context.timezone,
        shifts: context.shifts,
        location: context.location,
        geo: context.geo,
      },
      at,
      this.ids.newId(),
    );
    const write: CardClockWrite = {
      result: plan.result,
      open: context.open,
      closeAt: plan.closeAt,
      geo: plan.geo,
      at,
      schedule: plan.schedule,
    };
    await tx.persist(write);
    return plan.result;
  }
}

function failedCardScan(error: unknown): boolean {
  return (
    error instanceof AttendanceError && (error.code === 'NOT_FOUND' || error.code === 'BAD_REQUEST')
  );
}
