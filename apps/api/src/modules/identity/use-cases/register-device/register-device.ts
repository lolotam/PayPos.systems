import type { IdGenerator } from '../../../../shared/ports/id-generator.port.ts';
import { DEVICE_REGISTERED, type DeviceRegistered } from '../../events/published.ts';
import type { DeviceSecrets, DeviceTransactions, PairingCodes } from '../../ports/devices.port.ts';

/** The pairing code is unknown, used or expired — one answer for all three. */
export class PairingCodeInvalidError extends Error {
  override readonly name = 'PairingCodeInvalidError';
}

export interface RegisterDeviceInput {
  readonly code: string;
  readonly label: string;
  readonly fingerprint: string | null;
  readonly appVersion: string | null;
}

// A device redeems a pairing code: it is recorded PENDING in the code's branch and gets a one-time claim secret with
// which it collects its token once a manager approves it.
export class RegisterDevice {
  readonly #codes: PairingCodes;
  readonly #transactions: DeviceTransactions;
  readonly #secrets: DeviceSecrets;
  readonly #ids: IdGenerator;

  constructor(
    codes: PairingCodes,
    transactions: DeviceTransactions,
    secrets: DeviceSecrets,
    ids: IdGenerator,
  ) {
    this.#codes = codes;
    this.#transactions = transactions;
    this.#secrets = secrets;
    this.#ids = ids;
  }

  /**
   * @param input the pairing code and what the device says about itself
   * @returns the company, the new device id and the claim secret — shown to the device once
   */
  async execute(
    input: RegisterDeviceInput,
  ): Promise<{ companyId: string; deviceId: string; claimSecret: string }> {
    const target = await this.#codes.consume(input.code);
    if (target === null) throw new PairingCodeInvalidError();
    const deviceId = this.#ids.newId();
    const claimSecret = this.#secrets.newSecret();
    await this.#transactions.run(target.companyId, null, async (scope) => {
      await scope.insertPending({
        id: deviceId,
        branchId: target.branchId,
        label: input.label,
        fingerprint: input.fingerprint,
        appVersion: input.appVersion,
        claimHash: this.#secrets.hash(claimSecret),
      });
      await scope.audit.record({
        entity: 'device',
        entityId: deviceId,
        action: 'device.registered',
        after: { branch_id: target.branchId, label: input.label, app_version: input.appVersion },
      });
      const payload: DeviceRegistered = {
        device_id: deviceId,
        branch_id: target.branchId,
        company_id: target.companyId,
      };
      await scope.outbox.append({
        aggregateType: 'device',
        aggregateId: deviceId,
        eventType: DEVICE_REGISTERED,
        payload,
      });
    });
    return { companyId: target.companyId, deviceId, claimSecret };
  }
}
