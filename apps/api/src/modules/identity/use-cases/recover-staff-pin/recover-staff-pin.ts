import type { StaffPinWriter } from '@pospay/auth';
import type { Clock } from '../../../../shared/ports/clock.port.ts';
import { isWellFormedCashierPin } from '../../domain/cashier-pin.ts';
import { staffPinRecoveredEvent } from '../../events/published.ts';
import type { PinAttempts, PinHasher } from '../../ports/cashier-pins.port.ts';
import type { StaffPinTransactions } from '../../ports/staff-pins.port.ts';

/**
 * الموظفة بتستعيد رقمها السري بنفسها بعد ما أثبتت ملكية قناتها بكود: رقم دائم بمعرّف جديد، والغلطات
 * القديمة بتتمسح، والمالك بيوصله جرس من غير الرقم ولا الإيميل (spec 079 PR-c1، TQ-3).
 */
export class RecoverStaffPin implements StaffPinWriter {
  constructor(
    private readonly db: StaffPinTransactions,
    private readonly hasher: PinHasher,
    private readonly attempts: PinAttempts,
    private readonly clock: Clock,
  ) {}

  async hash(pin: string): Promise<string> {
    if (!isWellFormedCashierPin(pin)) throw new Error('STAFF_PIN_MALFORMED');
    return this.hasher.hash(pin);
  }

  async apply(input: Parameters<StaffPinWriter['apply']>[0]): Promise<boolean> {
    const { device, userId } = input;
    const at = this.clock.now();
    const done = await this.db.run(device.companyId, userId, async (scope) => {
      if (!(await scope.member(userId))) return false;
      // إيميل الاستعادة بيتقرا ويتقارن تحت قفل الشركة نفسه: إيميل اتغيّر بعد الطلب بيبطل الاستعادة.
      if (input.channel === 'EMAIL' && !input.emailMatches(await scope.recoveryEmail(userId)))
        return false;
      const employeeId = await scope.recoverPin({ userId, hash: input.hash, at });
      if (employeeId === null) return false;
      await scope.audit.record({
        entity: 'cashier_pin',
        entityId: userId,
        action: 'staff.pin_recovered',
        after: { channel: input.channel },
      });
      // الموظفة هي الفاعلة: الجرس بيوصل المالك بمعرّفات بس، من غير الرقم ولا الإيميل.
      const notice = staffPinRecoveredEvent({
        employee_id: employeeId,
        user_id: userId,
        branch_id: device.branchId,
        actor_user_id: userId,
        occurred_at: at.toISOString(),
      });
      await scope.outbox.append({ ...notice, aggregateId: employeeId });
      return true;
    });
    if (done)
      await this.attempts
        .clear({ companyId: device.companyId, employeeId: `staff-user:${userId}` })
        .catch(() => undefined);
    return done;
  }
}
