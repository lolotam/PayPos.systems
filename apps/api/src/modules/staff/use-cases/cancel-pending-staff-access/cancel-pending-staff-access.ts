import { StaffAccessError } from '../../domain/errors.ts';
import {
  pendingStaffAccessCancellable,
  staffAccessCancelAllowed,
  type StaffAccessRecordRow,
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

/**
 * نتيجة الإلغاء الملتزم: السجل اتشال أو رجع متوقفاً. الرد بعد الإلغاء مبني عليها من غير قراءة
 * تانية، ففشل قراءة الحالة بعد الالتزام ما يقدرش يحوّل نتيجة ملتومة لخطأ (AC-ACT-11).
 */
export type CancelPendingStaffAccessOutcome = {
  /** `cancelled` لما السجل اتشال، `restored` لما رجع متوقفاً. */
  readonly kind: 'cancelled' | 'restored';
  /** دور السجل لما يرجع متوقفاً؛ null لما السجل يتشال. */
  readonly role: StaffAccessRecordRow['roleCode'] | null;
  /** فرع السجل لما يرجع متوقفاً؛ null لما السجل يتشال. */
  readonly branchId: string | null;
};

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
   * فحص السلطة قبل وجود السجل: المتصل بلا سلطان يسمع نفس الرفض سواء وُجد السجل أم لا (AC-ACT-11).
   *
   * @param command الموظفة والمانح من الجلسة
   * @returns النتيجة الملتزمة: `cancelled` أو `restored` مع دور السجل وفرعه لما يرجع متوقفاً
   */
  async execute(command: CancelPendingStaffAccessCommand): Promise<CancelPendingStaffAccessOutcome> {
    const actor: StaffAccessActor = { companyId: command.companyId, userId: command.userId };
    const input = {
      businessId: command.businessId,
      employeeId: command.employeeId,
      ids: this.ids,
      at: this.clock.now(),
    };
    const locked = await this.steps.run(actor, input, async (scope) => {
      const { employee, record } = await scope.lock();
      if (employee === null) throw new StaffAccessError('EMPLOYEE_NOT_FOUND');
      if (employee.userId === actor.userId) throw new StaffAccessError('STAFF_ACCESS_NOT_ALLOWED');
      if (!(await scope.authority(employee.businessId, employee.primaryBranchId)))
        throw new StaffAccessError('STAFF_ACCESS_NOT_ALLOWED');
      if (record === null) throw new StaffAccessError('EMPLOYEE_NOT_FOUND');
      if (!pendingStaffAccessCancellable(record, input.at))
        throw new StaffAccessError('STAFF_ACCESS_NOT_ALLOWED');
      if (!staffAccessCancelAllowed(record, actor.userId, await scope.actorIsOwner()))
        throw new StaffAccessError('STAFF_ACCESS_NOT_ALLOWED');
      if (record.userId !== null) {
        if (!(await scope.restoreStopped(record.id)))
          throw new StaffAccessError('STAFF_ACCESS_NOT_ALLOWED');
        return { record, restored: true as const };
      }
      if (record.state === 'PENDING' && !(await scope.markCancelling(record.id)))
        throw new StaffAccessError('STAFF_ACCESS_NOT_ALLOWED');
      return { record, restored: false as const };
    });
    if (locked.restored)
      return {
        kind: 'restored',
        role: locked.record.roleCode,
        branchId: locked.record.branchId,
      };
    await this.cancelUser({
      operationId: locked.record.operationId,
      companyId: command.companyId,
      actorUserId: command.userId,
      ids: this.ids,
    });
    await this.steps.run(actor, input, async (scope) => {
      await scope.lock();
      if (!(await scope.deleteRecord(locked.record.id)))
        throw new StaffAccessError('STAFF_ACCESS_ALREADY_GRANTED');
    });
    return { kind: 'cancelled', role: null, branchId: null };
  }
}
