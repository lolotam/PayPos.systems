import { StaffAccessError } from '../../domain/errors.ts';
import type {
  GrantBeginOutcome,
  GrantEmployeeAccessCommand,
  GrantEmployeeAccessSteps,
  StaffAccessActor,
  StaffAccessGrantCache,
  StaffAccessIds,
  StaffAccessUserSteps,
} from '../../ports/staff-access.port.ts';
import type { Clock } from '../../../../shared/ports/clock.port.ts';

export { StaffAccessError };

/** بيُنجز «إعطاء دخول» لموظفة على فرعها الأساسي بخطوات قابلة للاستئناف بمعرّف العملية (FR-F1-6). */
export class GrantEmployeeAccessUseCase {
  constructor(
    private readonly steps: GrantEmployeeAccessSteps,
    private readonly users: StaffAccessUserSteps,
    private readonly cache: StaffAccessGrantCache,
    private readonly clock: Clock,
    private readonly ids: StaffAccessIds,
  ) {}

  /**
   * بيشغّل الخطوات بالترتيب: قفل الموظفة وفحص السلطة وسجل الانتظار، ثم المستخدم على auth بمعرّف
   * العملية، ثم العضوية والربط والرقم المؤقت والحدث في تراجع واحد، وبعد الالتزام إبطال الكاش.
   * التكرار بعد النجاح بيرجّع «already» بلا كتابة ولا حدث تاني (plan §4.2 خطوة 3).
   *
   * @param command الموظفة والدور والهاتف والرقم السري والمانح من الجلسة
   * @returns `already` لتكرار ناجح، أو `granted` بمعرّف العضوية والمستخدم
   */
  async execute(
    command: GrantEmployeeAccessCommand,
  ): Promise<
    { kind: 'already' } | { kind: 'granted'; membershipId: string; userId: string }
  > {
    const begin = await this.#begin(command);
    const { userId } = await this.users.provision({
      operationId: begin.record.operationId,
      companyId: command.companyId,
      actorUserId: command.userId,
      phone: command.phone,
      name: begin.employee.displayName,
      ids: this.ids,
    });
    const pinHash = await this.users.hash(command.pin);
    const outcome = await this.#commit(command, begin, userId, pinHash);
    if (outcome.kind === 'granted')
      await this.cache.invalidate({
        companyId: command.companyId,
        membershipId: outcome.membershipId,
      });
    return outcome;
  }

  /** الخطوة الأولى: القفل وفحوصات own-record والسجل النشط والسلطة وإنشاء سجل الانتظار. */
  async #begin(command: GrantEmployeeAccessCommand): Promise<GrantBeginOutcome> {
    const actor: StaffAccessActor = { companyId: command.companyId, userId: command.userId };
    return this.steps.begin(
      actor,
      {
        businessId: command.businessId,
        employeeId: command.employeeId,
        ids: this.ids,
        at: this.clock.now(),
      },
      async (scope) => {
        const employee = await scope.lockEmployee();
        if (employee === null) throw new StaffAccessError('EMPLOYEE_NOT_FOUND');
        if (employee.userId === actor.userId) throw new StaffAccessError('STAFF_ACCESS_NOT_ALLOWED');
        const record = await scope.findRecord();
        if (employee.userId !== null && (record === null || record.userId !== employee.userId))
          throw new StaffAccessError('STAFF_ACCESS_NOT_ALLOWED');
        if (record !== null && record.state === 'ACTIVE')
          throw new StaffAccessError('STAFF_ACCESS_ALREADY_GRANTED');
        if (!(await scope.authority(employee.businessId, employee.primaryBranchId)))
          throw new StaffAccessError('STAFF_ACCESS_NOT_ALLOWED');
        if (record !== null) return { record, employee };
        const inserted = await scope.insertRecord({
          roleCode: command.role,
          branchId: employee.primaryBranchId,
        });
        return { record: inserted, employee };
      },
    );
  }

  /** الخطوة الثالثة: إعادة الفحص تحت القفل ثم العضوية والربط والرقم والحدث في تراجع واحد. */
  async #commit(
    command: GrantEmployeeAccessCommand,
    begin: GrantBeginOutcome,
    userId: string,
    pinHash: string,
  ): Promise<{ kind: 'already' } | { kind: 'granted'; membershipId: string; userId: string }> {
    const actor: StaffAccessActor = { companyId: command.companyId, userId: command.userId };
    return this.steps.commit(
      actor,
      {
        businessId: command.businessId,
        employeeId: command.employeeId,
        recordId: begin.record.id,
        ids: this.ids,
        at: this.clock.now(),
      },
      async (scope) => {
        if (!(await scope.lockCompany())) throw new StaffAccessError('EMPLOYEE_NOT_FOUND');
        const { employee, record } = await scope.recheck();
        if (employee === null || record === null) throw new StaffAccessError('EMPLOYEE_NOT_FOUND');
        if (record.state === 'ACTIVE') return { kind: 'already' } as const;
        if (
          employee.userId === actor.userId ||
          (employee.userId !== null && employee.userId !== userId)
        )
          throw new StaffAccessError('STAFF_ACCESS_NOT_ALLOWED');
        if (!(await scope.authority(employee.businessId, employee.primaryBranchId)))
          throw new StaffAccessError('STAFF_ACCESS_NOT_ALLOWED');
        await scope.bindUser({ recordId: record.id, userId });
        const granted = await scope.grantMembership({
          userId,
          branchId: employee.primaryBranchId,
          role: command.role,
        });
        if (employee.userId !== userId) await scope.linkEmployee(userId);
        await scope.saveTemporaryPin(userId, pinHash);
        await scope.markActive({ recordId: record.id, userId, membershipId: granted.membershipId });
        await scope.appendEvent({
          employeeId: command.employeeId,
          userId,
          membershipId: granted.membershipId,
          branchId: employee.primaryBranchId,
          role: command.role,
        });
        return { kind: 'granted', membershipId: granted.membershipId, userId } as const;
      },
    );
  }
}
