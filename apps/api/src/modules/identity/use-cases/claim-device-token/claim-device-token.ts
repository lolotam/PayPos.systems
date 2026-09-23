import type { Clock } from '../../../../shared/ports/clock.port.ts';
import { deviceTokenExpiry } from '../../domain/device-token.ts';
import type { DeviceSecrets, DeviceTransactions } from '../../ports/devices.port.ts';

export type ClaimOutcome =
  | { readonly kind: 'issued'; readonly token: string }
  | { readonly kind: 'pending' }
  | { readonly kind: 'refused' };

// An approved device exchanges its claim secret for its token — exactly once: the claim secret is erased with it.
export class ClaimDeviceToken {
  readonly #transactions: DeviceTransactions;
  readonly #secrets: DeviceSecrets;
  readonly #clock: Clock;

  constructor(transactions: DeviceTransactions, secrets: DeviceSecrets, clock: Clock) {
    this.#transactions = transactions;
    this.#secrets = secrets;
    this.#clock = clock;
  }

  /**
   * @param command the company and device the registration answered with, and the claim secret
   * @param command.companyId   the device's company
   * @param command.deviceId    the device
   * @param command.claimSecret the one-time claim secret
   * @returns the token once, 'pending' until a manager approves, or 'refused' for anything else
   */
  execute(command: {
    companyId: string;
    deviceId: string;
    claimSecret: string;
  }): Promise<ClaimOutcome> {
    return this.#transactions.run(command.companyId, null, async (scope) => {
      const device = await scope.findForUpdate(command.deviceId);
      if (device === null || !this.#secrets.verify(command.claimSecret, device.claimHash)) {
        return { kind: 'refused' };
      }
      if (device.status === 'PENDING') return { kind: 'pending' };
      if (device.status !== 'ACTIVE') return { kind: 'refused' };
      const secret = this.#secrets.newSecret();
      const now = this.#clock.now();
      await scope.update(device.id, {
        claimHash: null,
        tokenHash: this.#secrets.hash(secret),
        tokenExpiresAt: deviceTokenExpiry(now),
        lastSeenAt: now,
      });
      await scope.audit.record({
        entity: 'device',
        entityId: device.id,
        action: 'device.token_issued',
      });
      return {
        kind: 'issued',
        token: this.#secrets.format({ companyId: command.companyId, deviceId: device.id, secret }),
      };
    });
  }
}
