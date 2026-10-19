import type {
  CashierPinTransactions,
  PinAttempts,
  PinHasher,
} from '../../ports/cashier-pins.port.ts';

export type PinOutcome =
  | { readonly kind: 'verified'; readonly employeeId: string }
  | { readonly kind: 'refused' }
  | { readonly kind: 'locked' }
  | { readonly kind: 'busy' };

// An approved device proves which employee is at the till (ADR-0003 §4 path B). A comparison is reserved before it
// starts, so however many requests arrive together, no more than five failures are possible before the lock; the
// fifth failure locks the PIN for 15 minutes (PRD D-08). An unknown employee, a soft-deleted company whose
// stored hash is absent, and a company deleted during the slow compare are counted and refused like a wrong PIN.
export class VerifyCashierPin {
  readonly #transactions: CashierPinTransactions;
  readonly #hasher: PinHasher;
  readonly #attempts: PinAttempts;
  // الاختبار بيسجّل الحذف بعد المقارنة وقبل تسجيل النجاح. الإنتاج بيسيبه فاضي.
  afterCompare: (() => Promise<void>) | null = null;

  constructor(transactions: CashierPinTransactions, hasher: PinHasher, attempts: PinAttempts) {
    this.#transactions = transactions;
    this.#hasher = hasher;
    this.#attempts = attempts;
  }

  /**
   * @param command the device's verified company, the employee and the PIN typed at the till
   * @param command.companyId  the device's company
   * @param command.employeeId the employee claiming the till
   * @param command.pin        the PIN as typed
   * @returns verified with the employee, refused, locked, or busy (five comparisons in flight, or this one expired)
   */
  async execute(command: {
    companyId: string;
    employeeId: string;
    pin: string;
  }): Promise<PinOutcome> {
    const { companyId, employeeId } = command;
    const target = { companyId, employeeId };
    // الحجز قبل قراءة الـ hash عشان الشركة المحذوفة تتحسب زي PIN غلط بنفس العدّ والوقت.
    // قفل القراءة FOR SHARE بيتعارض مع أي UPDATE، والمقارنة البطيئة بتفضل بره المعاملة.
    const reserved = await this.#attempts.reserve(target);
    if (reserved.kind !== 'ok') return { kind: reserved.kind };
    let matches: boolean;
    try {
      const hash = await this.#transactions.run(companyId, null, (scope) =>
        scope.findHash(employeeId),
      );
      matches = await this.#hasher.verify(command.pin, hash);
      if (matches && this.afterCompare !== null) await this.afterCompare();
    } catch (error) {
      await this.#attempts.release(target, reserved.reservation);
      throw error;
    }
    // النجاح بيتسجل والشركة متقفلة FOR SHARE في نفس المعاملة؛ حذف أثناء المقارنة يبقى PIN غلط.
    if (matches) {
      let recorded: Awaited<ReturnType<VerifyCashierPin['recordSuccess']>>;
      try {
        recorded = await this.recordSuccess(companyId, target, reserved.reservation);
      } catch (error) {
        // عطل في معاملة التسجيل مايسيبش الحجز ماسك خانة محاولة لحد ما ينتهي.
        await this.#attempts.release(target, reserved.reservation);
        throw error;
      }
      if (recorded === 'ok') return { kind: 'verified', employeeId };
      if (recorded === 'locked') return { kind: 'locked' };
      if (recorded === 'expired') return { kind: 'busy' };
    }
    return this.#countWrongPin(companyId, employeeId, reserved.reservation);
  }

  private recordSuccess(
    companyId: string,
    target: { companyId: string; employeeId: string },
    reservation: string,
  ) {
    return this.#transactions.run(companyId, null, async (scope) => {
      if (!(await scope.companyOpen())) return 'inactive' as const;
      return this.#attempts.succeeded(target, reservation);
    });
  }

  async #countWrongPin(
    companyId: string,
    employeeId: string,
    reservation: string,
  ): Promise<PinOutcome> {
    const failed = await this.#attempts.failed({ companyId, employeeId }, reservation);
    if (failed === 'failed') return { kind: 'refused' };
    if (failed === 'expired') return { kind: 'busy' };
    await this.#transactions.run(companyId, null, (scope) =>
      scope.audit.record({
        entity: 'cashier_pin',
        entityId: employeeId,
        action: 'cashier_pin.locked',
      }),
    );
    return { kind: 'locked' };
  }
}
