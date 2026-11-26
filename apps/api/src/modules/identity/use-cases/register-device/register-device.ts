import type { IdGenerator } from '../../../../shared/ports/id-generator.port.ts';
import { computeDeviceCheckCode } from '../../domain/device-check-code.ts';
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
// which it collects its token once a manager approves it. The code is claimed before the registration and consumed
// inside the same transaction, so a code the manager replaced can never be redeemed.
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
   * @returns the company, the new device id, the claim secret and the check code — shown to the device once
   */
  async execute(
    input: RegisterDeviceInput,
  ): Promise<{ companyId: string; deviceId: string; claimSecret: string; checkCode: string }> {
    const claimed = await this.#codes.claim(input.code);
    if (claimed === null) throw new PairingCodeInvalidError();
    const deviceId = this.#ids.newId();
    const claimSecret = this.#secrets.newSecret();
    try {
      const checkCode = await this.#transactions.run(claimed.companyId, null, async (scope) => {
        // القفل FOR SHARE بيتاخد قبل الإدراج وبيتعارض مع أي UPDATE للشركة؛ شركة اتحذفت زي كود باطل ومن غير جهاز.
        if (!(await scope.companyOpen())) throw new PairingCodeInvalidError();
        await scope.insertPending({
          id: deviceId,
          branchId: claimed.branchId,
          label: input.label,
          fingerprint: input.fingerprint,
          appVersion: input.appVersion,
          claimHash: this.#secrets.hash(claimSecret),
        });
        const code = computeDeviceCheckCode(deviceId);
        await scope.audit.record({
          entity: 'device',
          entityId: deviceId,
          action: 'device.registered',
          after: { branch_id: claimed.branchId, label: input.label, app_version: input.appVersion },
        });
        const payload: DeviceRegistered = {
          device_id: deviceId,
          branch_id: claimed.branchId,
          company_id: claimed.companyId,
        };
        await scope.outbox.append({
          aggregateType: 'device',
          aggregateId: deviceId,
          eventType: DEVICE_REGISTERED,
          payload,
        });
        // آخر خطوة جوّه الـ transaction: الكود يتأكد إنه لسه حي للفرع وسه محجوز لينا قبل ما الـ commit يثبت.
        const consumed = await this.#codes.consume({
          code: input.code,
          companyId: claimed.companyId,
          branchId: claimed.branchId,
          claimId: claimed.claimId,
        });
        if (!consumed) throw new PairingCodeInvalidError();
        return code;
      });
      return { companyId: claimed.companyId, deviceId, claimSecret, checkCode };
    } catch (error) {
      // الـ transaction فشل قبل الأكل: الحجز بيتفكّ عشان الكود يرجع متاح بدل ما يفضل مقفول.
      await this.#codes.release(input.code, claimed.claimId).catch(() => undefined);
      throw error;
    }
  }
}
