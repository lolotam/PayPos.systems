import type { StaffSessions } from '@pospay/auth';
import { STAFF_LOGIN_CONCURRENCY } from '@pospay/auth';

import type { PinAttempts, PinHasher } from '../../ports/cashier-pins.port.ts';
import type {
  ApproverPinDevice,
  ApproverPinOutcome,
  DevicePinCap,
  DeviceValidity,
} from '../../ports/discount-approver-pin.port.ts';
import type { StaffPinRecord, StaffPinTransactions } from '../../ports/staff-pins.port.ts';

// بيتحقق من PIN اعتماد الخصم على جهاز مقترن (ADR-0051 §3، D-10): نفس منشأة دخول الموظفين بالظبط، من غير
// جلسة ومن غير شرط login:staff — إثبات لإجراء واحد بس. وسقف الجهاز (D-15) بيقفل الاعتماد كله لو الجهاز
// جرّب أرقام كتير من أي هاتف.
export class VerifyDiscountApproverPin {
  private active = 0;

  constructor(
    private readonly db: StaffPinTransactions,
    private readonly hasher: PinHasher,
    private readonly attempts: PinAttempts,
    private readonly sessions: StaffSessions,
    private readonly cap: DevicePinCap,
    private readonly devices: DeviceValidity,
  ) {}

  /**
   * @param input        الهاتف والـ PIN والجهاز اللي بتتحقق منه
   * @param input.phone  الهاتف المرتبط عالمياً والمعتمد
   * @param input.pin    الـ PIN كما اتكتب
   * @param input.device الجهاز المقترن اللي طلب الموافقة
   * @returns صاحب الاعتماد وإصداره، أو رفض أو قفل أو زحام
   */
  async execute(input: {
    phone: string;
    pin: string;
    device: ApproverPinDevice;
  }): Promise<ApproverPinOutcome> {
    if (this.active >= STAFF_LOGIN_CONCURRENCY) return { kind: 'busy' };
    this.active++;
    try {
      return await this.verify(input);
    } finally {
      this.active--;
    }
  }

  private async verify(input: {
    phone: string;
    pin: string;
    device: ApproverPinDevice;
  }): Promise<ApproverPinOutcome> {
    const admitted = await this.cap.admit(input.device);
    if (admitted.kind === 'locked') {
      await this.hasher.verify(input.pin, null);
      return { kind: 'locked' };
    }
    const admission = admitted.admission;
    await this.sessions.ready();
    const userId = await this.sessions.candidate(input.phone);
    const target = {
      companyId: input.device.companyId,
      employeeId:
        userId === null
          ? this.sessions.pinCounterKey(input.phone)
          : `staff-user:${userId}`,
    };
    const reserved = await this.attempts.reserve(target);
    if (reserved.kind !== 'ok') {
      await this.cap.release(input.device, admission);
      await this.hasher.verify(input.pin, null);
      return reserved.kind === 'locked' ? { kind: 'locked' } : { kind: 'busy' };
    }
    let row: StaffPinRecord | null;
    let matches: boolean;
    try {
      row = userId === null ? null : await this.read(userId, input.device.companyId);
      matches = await this.hasher.verify(input.pin, row?.hash ?? null);
    } catch (error) {
      await this.attempts.release(target, reserved.reservation);
      await this.cap.release(input.device, admission);
      throw error;
    }
    if (!matches || row === null || userId === null) {
      return await this.refused(input.device, target, reserved.reservation, admission);
    }
    const recorded = await this.attempts.succeeded(target, reserved.reservation);
    if (recorded !== 'ok') {
      await this.cap.release(input.device, admission);
      return recorded === 'locked' ? { kind: 'locked' } : { kind: 'busy' };
    }
    const capped = await this.cap.success(input.device, admission);
    if (capped === 'locked') return { kind: 'locked' };
    if (capped === 'expired') return { kind: 'busy' };
    return await this.current(input.phone, input.device, userId, row);
  }

  private async refused(
    device: ApproverPinDevice,
    target: { companyId: string; employeeId: string },
    reservation: string,
    admission: string,
  ): Promise<ApproverPinOutcome> {
    const failed = await this.attempts.failed(target, reservation);
    const capped = await this.cap.failure(device, admission);
    if (capped === 'locked' || capped === 'lockedNew') {
      if (capped === 'lockedNew') await this.auditDeviceLock(device);
      return { kind: 'locked' };
    }
    if (failed === 'locked') return { kind: 'locked' };
    if (failed === 'expired' || capped === 'expired') return { kind: 'busy' };
    return { kind: 'refused' };
  }

  // إعادة الفحص بعد المقارنة (مناقشة #2): تغيّر الـ PIN أو ارتباط الهاتف أو سحب الجهاز أثناء المقارنة
  // ما ينفعش يسيب إثبات صالح.
  private async current(
    phone: string,
    device: ApproverPinDevice,
    userId: string,
    row: StaffPinRecord,
  ): Promise<ApproverPinOutcome> {
    const sameHolder = (await this.sessions.candidate(phone)) === userId;
    const sameRevision = (await this.read(userId, device.companyId))?.id === row.id;
    const validDevice = await this.devices.valid(device);
    if (!sameHolder || !sameRevision || !validDevice) return { kind: 'refused' };
    return { kind: 'ok', userId, pinRevision: row.id };
  }

  private read(userId: string, companyId: string): Promise<StaffPinRecord | null> {
    return this.db.run(companyId, null, (scope) => scope.find(userId));
  }

  private auditDeviceLock(device: ApproverPinDevice): Promise<void> {
    return this.db.run(device.companyId, null, (scope) =>
      scope.audit.record({
        entity: 'device',
        entityId: device.deviceId,
        action: 'device.pin_approval_locked',
      }),
    );
  }
}
