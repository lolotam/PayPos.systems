import type { StaffDeviceContext } from '@pospay/auth';
import { StaffProofChanged, STAFF_LOGIN_CONCURRENCY } from '@pospay/auth';
import type { Clock } from '../../../../shared/ports/clock.port.ts';
import type { IdGenerator } from '../../../../shared/ports/id-generator.port.ts';
import { StaffPinError } from '../staff-pin-error.ts';
import { staffPinProofExpiresAt } from '../../domain/staff-pin-proof.ts';
import { pinState } from '../../domain/staff-pin-state.ts';
import type { PinAttempts, PinHasher } from '../../ports/cashier-pins.port.ts';
import type {
  StaffPinAuthority,
  StaffPinProofIssuer,
  StaffPinRecord,
  StaffPinTransactions,
} from '../../ports/staff-pins.port.ts';

/** PIN المستخدم نفسه فقط؛ إثباته لا يستعمل employeeId العائد من المسار القديم. */
export class SignInStaffPin {
  private active = 0;
  constructor(
    private readonly db: StaffPinTransactions,
    private readonly hasher: PinHasher,
    private readonly attempts: PinAttempts,
    private readonly authority: StaffPinAuthority,
    private readonly proofs: StaffPinProofIssuer,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
    private readonly staffAccessRoutes: boolean,
  ) {}

  /** الجهاز متحقق مسبقاً، والربط العالمي المعتمد يحدد صاحب الإثبات. */
  async execute(input: { phone: string; pin: string; device: StaffDeviceContext }) {
    if (this.active >= STAFF_LOGIN_CONCURRENCY) throw new Error('STAFF_PIN_UNAVAILABLE');
    this.active++;
    try {
      return await this.signIn(input);
    } finally {
      this.active--;
    }
  }

  private async signIn(input: { phone: string; pin: string; device: StaffDeviceContext }) {
    await this.authority.sessions.ready();
    const userId = await this.authority.sessions.candidate(input.phone);
    const target = {
      companyId: input.device.companyId,
      employeeId:
        userId === null
          ? this.authority.sessions.pinCounterKey(input.phone)
          : `staff-user:${userId}`,
    };
    const reservation = await this.attempts.reserve(target);
    if (reservation.kind !== 'ok') {
      await this.hasher.verify(input.pin, null);
      return null;
    }
    let row: StaffPinRecord | null;
    let matches: boolean;
    try {
      row = userId === null ? null : await this.read(userId, input.device);
      matches = await this.hasher.verify(input.pin, row?.hash ?? null);
    } catch (error) {
      await this.attempts.release(target, reservation.reservation);
      throw error;
    }
    if (!matches || row === null || userId === null) {
      await this.attempts.failed(target, reservation.reservation);
      return null;
    }
    // قبل فتح شريحة F2 الرقم المؤقت زي أي رقم غلط: مفيش تغيير ولا دليل ولا جلسة.
    if (!this.staffAccessRoutes && row.temporary === true) {
      await this.attempts.failed(target, reservation.reservation);
      return null;
    }
    // الأهلية قبل أي حالة PIN مؤقت: موقوفة أو جهاز غير معتمد = رقم غلط، بلا دليل ولا رسالة تغيير.
    if (!(await this.current(userId, row.id, input))) {
      await this.attempts.failed(target, reservation.reservation);
      return null;
    }
    const state = this.staffAccessRoutes ? pinState(row, this.clock.now()) : 'USABLE';
    if (state !== 'USABLE') {
      // الرقم اتقبل، فالعدّاد بيتصفّر؛ الردّ بيقول لازم يتغيّر، ومفيش جلسة بتتصدر.
      if ((await this.attempts.succeeded(target, reservation.reservation)) !== 'ok') return null;
      if (state === 'EXPIRED') throw new StaffPinError('PIN_EXPIRED');
      throw new StaffPinError(
        'PIN_CHANGE_REQUIRED',
        await this.issueChangeProof(userId, row, input.device),
      );
    }
    if ((await this.attempts.succeeded(target, reservation.reservation)) !== 'ok') return null;
    if (!(await this.current(userId, row.id, input))) return null;
    return this.issueSession(userId, row, input);
  }

  private async issueSession(
    userId: string,
    row: StaffPinRecord,
    input: { phone: string; device: StaffDeviceContext },
  ) {
    try {
      return await this.authority.sessions.issue(userId, input.device, async () => {
        if (!(await this.current(userId, row.id, input))) return false;
        await this.db.run(input.device.companyId, userId, (scope) =>
          scope.audit.record({
            entity: 'cashier_pin',
            entityId: userId,
            action: 'staff.pin_signed_in',
          }),
        );
        return true;
      });
    } catch (error) {
      if (error instanceof StaffProofChanged) return null;
      throw error;
    }
  }

  /** بيصدر دليل تغيير للرقم المؤقت: البصمة بس بتتخزن، والدليل الخام بيرجع للعميل مرة واحدة. */
  private async issueChangeProof(
    userId: string,
    row: StaffPinRecord,
    device: StaffDeviceContext,
  ): Promise<string> {
    const now = this.clock.now();
    const issued = this.proofs.issue();
    await this.db.run(device.companyId, userId, (scope) =>
      scope.issueProof({
        id: this.ids.newId(),
        userId,
        deviceId: device.deviceId,
        pinRevision: row.id,
        proofHash: issued.hash,
        at: now,
        expiresAt: staffPinProofExpiresAt(now),
      }),
    );
    return issued.proof;
  }

  private read(userId: string, device: StaffDeviceContext) {
    return this.db.run(device.companyId, null, (scope) => scope.find(userId));
  }
  private async current(
    userId: string,
    revision: string,
    input: { phone: string; device: StaffDeviceContext },
  ): Promise<boolean> {
    return (
      (await this.authority.sessions.candidate(input.phone)) === userId &&
      (await this.read(userId, input.device))?.id === revision &&
      (await this.authority.deviceValid(input.device)) &&
      (await this.authority.eligible(userId, input.device))
    );
  }
}
