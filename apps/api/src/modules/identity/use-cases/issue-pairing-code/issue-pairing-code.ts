import type { DeviceTransactions, PairingCodes } from '../../ports/devices.port.ts';

// A manager opens a pairing window for one branch: a single-use code, valid 10 minutes, audited (never its value).
export class IssuePairingCode {
  readonly #codes: PairingCodes;
  readonly #transactions: DeviceTransactions;

  constructor(codes: PairingCodes, transactions: DeviceTransactions) {
    this.#codes = codes;
    this.#transactions = transactions;
  }

  /**
   * @param command the verified company, the branch the guard checked, and the manager
   * @param command.companyId the verified company
   * @param command.branchId  the branch the device will belong to
   * @param command.userId    the manager issuing the code
   * @returns the code and when it expires
   */
  async execute(command: { companyId: string; branchId: string; userId: string }): Promise<{
    code: string;
    expiresAt: Date;
  }> {
    const issued = await this.#codes.issue(command);
    await this.#transactions.run(command.companyId, command.userId, (scope) =>
      scope.audit.record({
        entity: 'branch',
        entityId: command.branchId,
        action: 'device.pairing_code_issued',
        after: { expires_at: issued.expiresAt.toISOString() },
      }),
    );
    return issued;
  }
}
