import { isLockingFailure, isPinAttemptLocked } from '../../domain/cashier-pin.ts';
import type {
  CashierPinTransactions,
  PinAttempts,
  PinHasher,
} from '../../ports/cashier-pins.port.ts';

export type PinOutcome =
  | { readonly kind: 'verified'; readonly employeeId: string }
  | { readonly kind: 'refused' }
  | { readonly kind: 'locked' };

// An approved device proves which employee is at the till (ADR-0003 §4 path B). Every attempt is counted before the
// comparison, so no burst of requests gets more than five guesses; the fifth failure locks the PIN for 15 minutes
// (PRD D-08). An unknown employee is counted and refused exactly like a wrong PIN.
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
   * @returns verified with the employee, refused, or locked
   */
  async execute(command: {
    companyId: string;
    employeeId: string;
    pin: string;
  }): Promise<PinOutcome> {
    const { companyId, employeeId } = command;
    const attempt = await this.#attempts.reserve(companyId, employeeId);
    if (isPinAttemptLocked(attempt)) return { kind: 'locked' };
    const stored = await this.#transactions.run(companyId, null, (scope) =>
      scope.findHash(employeeId),
    );
    if (await this.#hasher.verify(command.pin, stored)) {
      await this.#attempts.clear(companyId, employeeId);
      return { kind: 'verified', employeeId };
    }
    if (!isLockingFailure(attempt)) return { kind: 'refused' };
    await this.#attempts.lock(companyId, employeeId);
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
