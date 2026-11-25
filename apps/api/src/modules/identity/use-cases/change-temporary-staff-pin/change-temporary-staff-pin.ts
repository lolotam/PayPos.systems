import type { StaffDeviceContext } from '@pospay/auth';
import type { Clock } from '../../../../shared/ports/clock.port.ts';
import { pinState } from '../../domain/staff-pin-state.ts';
import type { PinAttempts, PinHasher, PinTarget } from '../../ports/cashier-pins.port.ts';
import type {
  StaffPinProofIssuer,
  StaffPinProofRecord,
  StaffPinTransactions,
} from '../../ports/staff-pins.port.ts';

/** نتيجة تغيير الرقم السري المؤقت: اتغيّر، أو خلصت مدته، أو القفل شغال، أو رفض. */
export type ChangeTemporaryStaffPinOutcome =
  | { readonly kind: 'changed' }
  | { readonly kind: 'expired' }
  | { readonly kind: 'locked' }
  | { readonly kind: 'invalid' };

/** رفض جوه المعاملة: بيرمي عشان المعاملة تتراجع والدليل ما يتحرقش وما يتبدّلش رقم. */
class ChangeRefused extends Error {
  override readonly name = 'ChangeRefused';
}

/**
 * الموظفة بتغيّر الرقم السري المؤقت اللي حدده المانح: الدليل اللي جاي من الجلسة بيحدد
 * صاحبها وإصدار رقمها، والرقم الجديد بيدخل مكانه رقم دائم. المسار ما بيصدرش أي جلسة.
 */
export class ChangeTemporaryStaffPin {
  constructor(
    private readonly db: StaffPinTransactions,
    private readonly hasher: PinHasher,
    private readonly attempts: PinAttempts,
    private readonly proofs: StaffPinProofIssuer,
    private readonly clock: Clock,
  ) {}

  /**
   * @param input  الدليل والرقم الجديد والجهاز المتحقق
   * @returns نتيجة التغيير: اتغيّر، أو خلصت مدة الرقم، أو القفل، أو رفض
   */
  async execute(input: {
    proof: string;
    pin: string;
    device: StaffDeviceContext;
  }): Promise<ChangeTemporaryStaffPinOutcome> {
    const now = this.clock.now();
    const companyId = input.device.companyId;
    const proofHash = this.proofs.digest(input.proof);
    const found = await this.db.run(companyId, null, (scope) =>
      scope.findProof(input.device.deviceId, proofHash),
    );
    const target = this.target(companyId, input.device.deviceId, found);
    const reservation = await this.attempts.reserve(target);
    if (reservation.kind !== 'ok')
      return reservation.kind === 'locked' ? { kind: 'locked' } : { kind: 'invalid' };
    try {
      const outcome = await this.change(input, proofHash, found, now);
      const counted = outcome.kind === 'changed' || outcome.kind === 'expired';
      if (counted) await this.attempts.succeeded(target, reservation.reservation);
      else await this.attempts.failed(target, reservation.reservation);
      return outcome;
    } catch (error) {
      await this.attempts.failed(target, reservation.reservation);
      throw error;
    }
  }

  /** العدّاد: صاحب الدليل لو عرفناه، وإلا الجهاز — عشان تخمين الدليل يتقفل كمان. */
  private target(
    companyId: string,
    deviceId: string,
    found: StaffPinProofRecord | null,
  ): PinTarget {
    return {
      companyId,
      employeeId: found === null ? `staff-device:${deviceId}` : `staff-user:${found.userId}`,
    };
  }

  private async change(
    input: { proof: string; pin: string; device: StaffDeviceContext },
    proofHash: string,
    found: StaffPinProofRecord | null,
    now: Date,
  ): Promise<ChangeTemporaryStaffPinOutcome> {
    if (found === null || found.consumedAt !== null) return { kind: 'invalid' };
    if (found.expiresAt !== null && found.expiresAt.getTime() <= now.getTime())
      return { kind: 'invalid' };
    const row = await this.db.run(input.device.companyId, null, (scope) => scope.find(found.userId));
    if (row === null) return { kind: 'invalid' };
    const state = pinState(row, now);
    if (state === 'EXPIRED') return { kind: 'expired' };
    if (state !== 'CHANGE_REQUIRED') return { kind: 'invalid' };
    // الرقم الجديد لازم يكون مختلف عن الرقم المؤقت الحالي؛ التكرار رفض مش تغيير.
    if (await this.hasher.verify(input.pin, row.hash)) return { kind: 'invalid' };
    const hash = await this.hasher.hash(input.pin);
    return this.rotate(input, proofHash, found, hash, now);
  }

  /** استهلاك الدليل وتدوير الرقم في معاملة واحدة: يا اتنين بيحصلوا يا ولا واحد. */
  private async rotate(
    input: { proof: string; pin: string; device: StaffDeviceContext },
    proofHash: string,
    found: StaffPinProofRecord,
    hash: string,
    now: Date,
  ): Promise<ChangeTemporaryStaffPinOutcome> {
    try {
      return await this.db.run(input.device.companyId, found.userId, async (scope) => {
        const consumed = await scope.consumeProof({
          userId: found.userId,
          deviceId: input.device.deviceId,
          pinRevision: found.pinRevision,
          proofHash,
          at: now,
        });
        if (!consumed) throw new ChangeRefused();
        const rotated = await scope.rotatePin({
          userId: found.userId,
          pinRevision: found.pinRevision,
          hash,
          at: now,
        });
        if (!rotated) throw new ChangeRefused();
        await scope.audit.record({
          entity: 'cashier_pin',
          entityId: found.userId,
          action: 'staff.pin_changed',
        });
        return { kind: 'changed' } as const;
      });
    } catch (error) {
      if (error instanceof ChangeRefused) return { kind: 'invalid' };
      throw error;
    }
  }
}
