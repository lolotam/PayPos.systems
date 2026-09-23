import type { Clock } from '../../../../shared/ports/clock.port.ts';
import { deviceTokenExpiry, isDeviceTokenLive } from '../../domain/device-token.ts';
import type { DeviceSecrets, DeviceTransactions } from '../../ports/devices.port.ts';

export interface AuthenticatedDevice {
  readonly companyId: string;
  readonly deviceId: string;
  readonly branchId: string;
}

// Proves a device token inside the company it names (ADR-0003 §4 path B) and renews it for 30 days on success (D-09).
// Every failure is the same null, so the answer is no oracle for which companies or devices exist.
export class AuthenticateDevice {
  readonly #transactions: DeviceTransactions;
  readonly #secrets: DeviceSecrets;
  readonly #clock: Clock;

  constructor(transactions: DeviceTransactions, secrets: DeviceSecrets, clock: Clock) {
    this.#transactions = transactions;
    this.#secrets = secrets;
    this.#clock = clock;
  }

  /**
   * @param token the device token as the request carried it
   * @returns the device, or null when anything does not match
   */
  async execute(token: string): Promise<AuthenticatedDevice | null> {
    const parsed = this.#secrets.parse(token);
    if (parsed === null) return null;
    return this.#transactions.run(parsed.companyId, null, async (scope) => {
      const device = await scope.findForUpdate(parsed.deviceId);
      const now = this.#clock.now();
      if (
        device === null ||
        device.status !== 'ACTIVE' ||
        device.tokenExpiresAt === null ||
        !isDeviceTokenLive(device.tokenExpiresAt, now) ||
        !this.#secrets.verify(parsed.secret, device.tokenHash)
      ) {
        return null;
      }
      await scope.update(device.id, { tokenExpiresAt: deviceTokenExpiry(now), lastSeenAt: now });
      return { companyId: parsed.companyId, deviceId: device.id, branchId: device.branchId };
    });
  }
}
