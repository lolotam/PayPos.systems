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
   * @returns verified with the employee, refused, locked, or busy while five comparisons are already in flight
   */
  async execute(command: {
    companyId: string;
    employeeId: string;
    pin: string;
  }): Promise<PinOutcome> {
    const { companyId, employeeId } = command;
    const reserved = await this.#attempts.reserve(companyId, employeeId);
    if (reserved !== 'ok') return { kind: reserved };
    let matches: boolean;
    try {
      const stored = await this.#transactions.run(companyId, null, (scope) =>
        scope.findHash(employeeId),
      );
      matches = await this.#hasher.verify(command.pin, stored);
    } catch (error) {
      await this.#attempts.release(companyId, employeeId);
      throw error;
    }
    if (matches) {
      await this.#attempts.succeeded(companyId, employeeId);
      return { kind: 'verified', employeeId };
    }
    if ((await this.#attempts.failed(companyId, employeeId)) === 'failed') {
      return { kind: 'refused' };
    }
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
