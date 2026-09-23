import type { Clock } from '../../../../shared/ports/clock.port.ts';
import { DEVICE_REVOKED, type DeviceRevoked } from '../../events/published.ts';
import type { DeviceTransactions } from '../../ports/devices.port.ts';

/** No device with this id in this branch, or it is already revoked. */
export class DeviceNotFoundError extends Error {
  override readonly name = 'DeviceNotFoundError';
}

// A manager revokes a device of their branch: its token and claim secret are erased, so its next contact is refused.
export class RevokeDevice {
  readonly #transactions: DeviceTransactions;
  readonly #clock: Clock;

  constructor(transactions: DeviceTransactions, clock: Clock) {
    this.#transactions = transactions;
    this.#clock = clock;
  }

  /**
   * @param command the verified company and branch, the device and the revoking manager
   * @param command.companyId the verified company
   * @param command.branchId  the branch the guard authorized
   * @param command.deviceId  the device to revoke
   * @param command.userId    the revoking manager
   * @returns nothing; the device is REVOKED
   */
  execute(command: {
    companyId: string;
    branchId: string;
    deviceId: string;
    userId: string;
  }): Promise<void> {
    return this.#transactions.run(command.companyId, command.userId, async (scope) => {
      const device = await scope.findForUpdate(command.deviceId);
      if (device === null || device.branchId !== command.branchId || device.status === 'REVOKED') {
        throw new DeviceNotFoundError();
      }
      await scope.update(device.id, {
        status: 'REVOKED',
        claimHash: null,
        tokenHash: null,
        tokenExpiresAt: null,
        revokedBy: command.userId,
        revokedAt: this.#clock.now(),
      });
      await scope.audit.record({
        entity: 'device',
        entityId: device.id,
        action: 'device.revoked',
        before: { status: device.status },
        after: { status: 'REVOKED' },
      });
      const payload: DeviceRevoked = {
        device_id: device.id,
        branch_id: device.branchId,
        company_id: command.companyId,
      };
      await scope.outbox.append({
        aggregateType: 'device',
        aggregateId: device.id,
        eventType: DEVICE_REVOKED,
        payload,
      });
    });
  }
}
