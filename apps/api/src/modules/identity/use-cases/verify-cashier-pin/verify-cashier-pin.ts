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
// fifth failure locks the PIN for 15 minutes (PRD D-08). An unknown employee is counted and refused like a wrong PIN.
export class VerifyCashierPin {
  readonly #transactions: CashierPinTransactions;
  readonly #hasher: PinHasher;
  readonly #attempts: PinAttempts;

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
    const reserved = await this.#attempts.reserve(target);
    if (reserved.kind !== 'ok') return { kind: reserved.kind };
    let matches: boolean;
    try {
      const stored = await this.#transactions.run(companyId, null, (scope) =>
        scope.findHash(employeeId),
      );
      matches = await this.#hasher.verify(command.pin, stored);
    } catch (error) {
      await this.#attempts.release(target, reserved.reservation);
      throw error;
    }
    // A comparison that outlived its reservation no longer counts either way — the caller tries again.
    if (matches) {
      const done = await this.#attempts.succeeded(target, reserved.reservation);
      if (done === 'ok') return { kind: 'verified', employeeId };
      return { kind: done === 'locked' ? 'locked' : 'busy' };
    }
    const failed = await this.#attempts.failed(target, reserved.reservation);
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
