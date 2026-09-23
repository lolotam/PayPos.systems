import type { Clock } from '../../../../shared/ports/clock.port.ts';
import type { DeviceTransactions } from '../../ports/devices.port.ts';

/** No PENDING device with this id in this branch — unknown, another branch's, or already decided. */
export class DeviceNotPendingError extends Error {
  override readonly name = 'DeviceNotPendingError';
}

// A manager approves a pending device of their branch; the device can then collect its token, once.
export class ApproveDevice {
  readonly #transactions: DeviceTransactions;
  readonly #clock: Clock;

  constructor(transactions: DeviceTransactions, clock: Clock) {
    this.#transactions = transactions;
    this.#clock = clock;
  }

  /**
   * @param command the verified company and branch, the device and the approving manager
   * @param command.companyId the verified company
   * @param command.branchId  the branch the guard authorized
   * @param command.deviceId  the device to approve
   * @param command.userId    the approving manager
   * @returns nothing; the device is ACTIVE
   */
  execute(command: {
    companyId: string;
    branchId: string;
    deviceId: string;
    userId: string;
  }): Promise<void> {
    return this.#transactions.run(command.companyId, command.userId, async (scope) => {
      const device = await scope.findForUpdate(command.deviceId);
      if (device === null || device.branchId !== command.branchId || device.status !== 'PENDING') {
        throw new DeviceNotPendingError();
      }
      const now = this.#clock.now();
      await scope.update(device.id, {
        status: 'ACTIVE',
        approvedBy: command.userId,
        approvedAt: now,
      });
      await scope.audit.record({
        entity: 'device',
        entityId: device.id,
        action: 'device.approved',
        before: { status: 'PENDING' },
        after: { status: 'ACTIVE' },
      });
    });
  }
}
