import { StaffAccessError } from '../../domain/errors.ts';
import { pendingStaffAccessCancellable } from '../../domain/staff-access.ts';
import type {
  CancelPendingStaffAccessSteps,
  StaffAccessActor,
  StaffAccessIds,
} from '../../ports/staff-access.port.ts';
import type { Clock } from '../../../../shared/ports/clock.port.ts';

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
   * بيقفل السجل والموظفة، يفحص السلطة وقابلية الإلغاء (PENDING بعد 24 ساعة)، يحذف الحساب بمعرّف
   * العملية، ثم يحذف السجل بشرط «لسه PENDING» — سباق إتمام المنح بين الخطوتين يلغي الحذف ويُبقي
   * الحساب الجديد سليماً.
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
      return record;
    });
    await this.cancelUser({
      operationId: locked.operationId,
      companyId: command.companyId,
      actorUserId: command.userId,
      ids: this.ids,
    });
    await this.steps.run(actor, input, async (scope) => {
      if (!(await scope.deleteRecord(locked.id)))
        throw new StaffAccessError('STAFF_ACCESS_ALREADY_GRANTED');
    });
  }
}
