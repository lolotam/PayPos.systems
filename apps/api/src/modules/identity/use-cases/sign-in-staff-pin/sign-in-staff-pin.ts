import type { StaffDeviceContext } from '@pospay/auth';
import { StaffProofChanged, STAFF_LOGIN_CONCURRENCY } from '@pospay/auth';
import type { PinAttempts, PinHasher } from '../../ports/cashier-pins.port.ts';
import type {
  StaffPinAuthority,
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
    if ((await this.attempts.succeeded(target, reservation.reservation)) !== 'ok') return null;
    if (!(await this.current(userId, row.id, input))) return null;
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
