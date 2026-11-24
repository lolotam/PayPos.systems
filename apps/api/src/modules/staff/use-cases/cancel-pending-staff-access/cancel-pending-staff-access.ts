import { StaffAccessError } from '../../domain/errors.ts';
import {
  pendingStaffAccessCancellable,
  staffAccessCancelAllowed,
} from '../../domain/staff-access.ts';
import type {
  CancelPendingStaffAccessSteps,
  StaffAccessActor,
  StaffAccessIds,
} from '../../ports/staff-access.port.ts';
import type { Clock } from '../../../../shared/ports/clock.port.ts';

export { StaffAccessError };

/** أمر إلغاء سجل انتظار: الموظفة والمانح من الجلسة. */
export interface CancelPendingStaffAccessCommand {
  readonly companyId: string;
  readonly userId: string;
  readonly businessId: string;
  readonly employeeId: string;
}

/** بيُلغي سجل انتظار متجاوز للمدة: الحساب يُحذف في auth أولاً ثم السجل في معاملة الشركة. */
export class CancelPendingStaffAccessUseCase {
  constructor(
    private readonly steps: CancelPendingStaffAccessSteps,
    private readonly cancelUser: (input: {
      operationId: string;
      companyId: string;
      actorUserId: string;
      ids: StaffAccessIds;
    }) => Promise<void>,
    private readonly clock: Clock,
    private readonly ids: StaffAccessIds,
  ) {}

  /**
   * يثبت نية الإلغاء في CANCELLING تحت القفل قبل حذف auth، ثم يحذف السجل؛ أي تكرار يكمل نفس العملية.
   * السلطة للمانح الأصلي أو المالك؛ إعادة منح حساب ملتزم ترجع STOPPED داخل نفس المعاملة بلا حذف auth.
   *
   * @param command الموظفة والمانح من الجلسة
   */
  async execute(command: CancelPendingStaffAccessCommand): Promise<void> {
    const actor: StaffAccessActor = { companyId: command.companyId, userId: command.userId };
    const input = {
      businessId: command.businessId,
      employeeId: command.employeeId,
      ids: this.ids,
      at: this.clock.now(),
    };
    const locked = await this.steps.run(actor, input, async (scope) => {
      const { employee, record } = await scope.lock();
      if (employee === null || record === null) throw new StaffAccessError('EMPLOYEE_NOT_FOUND');
      if (employee.userId === actor.userId) throw new StaffAccessError('STAFF_ACCESS_NOT_ALLOWED');
      if (!pendingStaffAccessCancellable(record, input.at))
        throw new StaffAccessError('STAFF_ACCESS_NOT_ALLOWED');
      if (!(await scope.authority(employee.businessId, employee.primaryBranchId)))
        throw new StaffAccessError('STAFF_ACCESS_NOT_ALLOWED');
      if (!staffAccessCancelAllowed(record, actor.userId, await scope.actorIsOwner()))
        throw new StaffAccessError('STAFF_ACCESS_NOT_ALLOWED');
      if (record.userId !== null) {
        if (!(await scope.restoreStopped(record.id)))
          throw new StaffAccessError('STAFF_ACCESS_NOT_ALLOWED');
        return null;
      }
      if (record.state === 'PENDING' && !(await scope.markCancelling(record.id)))
        throw new StaffAccessError('STAFF_ACCESS_NOT_ALLOWED');
      return record;
    });
    if (locked === null) return;
    await this.cancelUser({
      operationId: locked.operationId,
      companyId: command.companyId,
      actorUserId: command.userId,
      ids: this.ids,
    });
    await this.steps.run(actor, input, async (scope) => {
      await scope.lock();
      if (!(await scope.deleteRecord(locked.id)))
        throw new StaffAccessError('STAFF_ACCESS_ALREADY_GRANTED');
    });
  }
}
