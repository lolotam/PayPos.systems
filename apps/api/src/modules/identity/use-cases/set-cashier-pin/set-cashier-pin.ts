import type { Clock } from '../../../../shared/ports/clock.port.ts';
import { isWellFormedCashierPin } from '../../domain/cashier-pin.ts';
import type { CashierPinTransactions, PinHasher } from '../../ports/cashier-pins.port.ts';

/** The PIN is not four digits (PRD D-08). */
export class CashierPinMalformedError extends Error {
  override readonly name = 'CashierPinMalformedError';
}

// A manager sets or replaces an employee's cashier PIN; only its hash is stored, and the change is audited.
export class SetCashierPin {
  readonly #transactions: CashierPinTransactions;
  readonly #hasher: PinHasher;
  readonly #clock: Clock;

  constructor(transactions: CashierPinTransactions, hasher: PinHasher, clock: Clock) {
    this.#transactions = transactions;
    this.#hasher = hasher;
    this.#clock = clock;
  }

  /**
   * @param command the verified company, the manager, the employee and the new PIN
   * @param command.companyId  the verified company
   * @param command.userId     the manager setting it
   * @param command.employeeId the employee the PIN identifies
   * @param command.pin        the new PIN
   * @returns nothing; the employee's PIN is the new one
   */
  async execute(command: {
    companyId: string;
    userId: string;
    employeeId: string;
    pin: string;
  }): Promise<void> {
    if (!isWellFormedCashierPin(command.pin)) throw new CashierPinMalformedError();
    // Hashed before the transaction opens: the hash is deliberately slow, and no row lock should wait on it.
    const pinHash = await this.#hasher.hash(command.pin);
    await this.#transactions.run(command.companyId, command.userId, async (scope) => {
      const saved = await scope.save({
        employeeId: command.employeeId,
        pinHash,
        setBy: command.userId,
        setAt: this.#clock.now(),
      });
      await scope.audit.record({
        entity: 'cashier_pin',
        entityId: command.employeeId,
        action: saved === 'created' ? 'cashier_pin.set' : 'cashier_pin.changed',
      });
    });
  }
}
