import type { Clock } from '../../../../shared/ports/clock.port.ts';
import { isWellFormedCashierPin } from '../../domain/cashier-pin.ts';
import type { PinHasher } from '../../ports/cashier-pins.port.ts';
import type { StaffPinTransactions } from '../../ports/staff-pins.port.ts';

/** المدير الحقيقي يبدل اعتماد المستخدم في شركته؛ لا يصدر جلسة بالنيابة عنه. */
export class ResetStaffPin {
  constructor(
    private readonly db: StaffPinTransactions,
    private readonly hasher: PinHasher,
    private readonly clock: Clock,
  ) {}
  /** actor هو المدير المتحقق؛ target صاحب الاعتماد فقط. */
  async execute(input: {
    companyId: string;
    actor: string;
    target: string;
    pin: string;
  }): Promise<boolean> {
    if (!isWellFormedCashierPin(input.pin)) return false;
    const hash = await this.hasher.hash(input.pin);
    return this.db.run(input.companyId, input.actor, async (scope) => {
      if (!(await scope.member(input.target))) return false;
      await scope.save(input.target, hash, input.actor, this.clock.now());
      await scope.audit.record({
        entity: 'cashier_pin',
        entityId: input.target,
        action: 'staff.pin_reset',
      });
      return true;
    });
  }
}
