import type { Clock } from '../../../../shared/ports/clock.port.ts';
import { deviceTokenExpiry, isDeviceTokenLive } from '../../domain/device-token.ts';
import type { DeviceSecrets, DeviceTransactions } from '../../ports/devices.port.ts';

export interface AuthenticatedDevice {
  readonly companyId: string;
  readonly deviceId: string;
  readonly branchId: string;
  /** false when the token is real and the company is soft-deleted; the guard hides that except on the OTP request. */
  readonly companyActive: boolean;
}

// Proves a device token inside the company it names (ADR-0003 §4 path B) and renews it for 30 days only while that
// company is still open (D-09). A soft-deleted company is companyActive: false and is not renewed; every other
// failure is the same null, so the answer is no oracle for which companies or devices exist.
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
   * @returns the device (companyActive false when it is soft-deleted), or null when anything does not match
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
      const proved = {
        companyId: parsed.companyId,
        deviceId: device.id,
        branchId: device.branchId,
      };
      // قراءة من غير قفل: المصادقة مش بتصدر اعتماد، ومينفعش تستنى حذف ناعم ولا تجدد توكن شركة اتقفلت.
      if (!(await scope.companyActive())) return { ...proved, companyActive: false };
      await scope.update(device.id, { tokenExpiresAt: deviceTokenExpiry(now), lastSeenAt: now });
      return { ...proved, companyActive: true };
    });
  }
}
