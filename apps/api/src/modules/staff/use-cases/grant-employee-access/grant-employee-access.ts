import { StaffAccessError } from '../../domain/errors.ts';
import type {
  GrantBeginOutcome,
  GrantCommitScope,
  GrantEmployeeAccessCommand,
  GrantEmployeeAccessSteps,
  StaffAccessActor,
  StaffAccessGrantCache,
  StaffAccessIds,
  StaffAccessUserSteps,
} from '../../ports/staff-access.port.ts';
import type { GrantBeginScope } from '../../ports/staff-access-begin.port.ts';
import type { Clock } from '../../../../shared/ports/clock.port.ts';

export { StaffAccessError };

/** أنواع سجل الخطوة الأولى كما تعود من الـ port. */
type BeginRecord = GrantBeginOutcome['record'];
type BeginEmployee = GrantBeginOutcome['employee'];

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
   * بيشغّل الخطوات بالترتيب: قفل الشركة والموظفة وفحص السلطة قبل أي إجابة كاشفة (P1-1)، ثم
   * المستخدم على auth بمعرّف العملية، ثم العضوية والربط والرقم المؤقت والحدث في تراجع واحد،
   * وبعد الالتزام إبطال الكاش. الاستئناف يقارن الهاتف والدور والفرع بالسجل المقفول (P1-4).
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
      recordState: begin.record.state === 'STOPPED' ? 'STOPPED' : 'PENDING',
      resetBinding: begin.record.state === 'STOPPED',
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

  /** الخطوة الأولى: الشركة ← الموظفة (P1-3)، والسلطة قبل أي رفض كاشف بالحالة (P1-1). */
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
        if (!(await scope.lockCompany())) throw new StaffAccessError('EMPLOYEE_NOT_FOUND');
        const employee = await scope.lockEmployee();
        if (employee === null) throw new StaffAccessError('EMPLOYEE_NOT_FOUND');
        if (!(await scope.authority(employee.businessId, employee.primaryBranchId)))
          throw new StaffAccessError('STAFF_ACCESS_NOT_ALLOWED');
        if (employee.userId === actor.userId)
          throw new StaffAccessError('STAFF_ACCESS_NOT_ALLOWED');
        const record = await scope.findRecord();
        if (employee.userId !== null && (record === null || record.userId !== employee.userId))
          throw new StaffAccessError('STAFF_ACCESS_NOT_ALLOWED');
        // سجل CANCELLING قيد الإلغاء: لا استئناف ولا منح متوازي (P1-2).
        if (record !== null && record.state === 'CANCELLING')
          throw new StaffAccessError('STAFF_ACCESS_NOT_ALLOWED');
        if (record !== null && record.state === 'ACTIVE')
          throw new StaffAccessError('STAFF_ACCESS_ALREADY_GRANTED');
        if (record !== null) return this.#reuseRecord(scope, command, employee, record);
        const inserted = await scope.insertRecord({
          roleCode: command.role,
          branchId: employee.primaryBranchId,
          phoneHash: scope.phoneHash(command.phone),
        });
        return { record: inserted, employee };
      },
    );
  }

  /** استئناف سجل قائم: الهاتف والدور والفرع لازم يطابقوا السجل المقفول — أي خلاف رفض بلا تفاصيل (P1-4). */
  async #reuseRecord(
    scope: BeginScope,
    command: GrantEmployeeAccessCommand,
    employee: BeginEmployee,
    record: BeginRecord,
  ): Promise<GrantBeginOutcome> {
    const phoneMatches = scope.phoneHash(command.phone) === record.phoneHash;
    const roleMatches = record.roleCode === command.role;
    const branchMatches = record.branchId === employee.primaryBranchId;
    if (!phoneMatches || !roleMatches || !branchMatches)
      throw new StaffAccessError('STAFF_ACCESS_NOT_ALLOWED');
    return { record, employee };
  }

  /** الخطوة الثالثة: إعادة الفحص تحت القفل والإثبات عبر auth ثم الكتابة من السجل المقفول (P1-4/P1-5). */
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
        // إثبات الربط عبر packages/auth (P1-5) — لا عضوية بلا إثبات منح بمعرّف العملية.
        await scope.assertBinding({
          companyId: command.companyId,
          userId,
          operationId: record.operationId,
        });
        const granted = await scope.grantMembership({
          userId,
          branchId: record.branchId,
          role: record.roleCode,
        });
        if (employee.userId !== userId) await scope.linkEmployee(userId);
        await scope.saveTemporaryPin(userId, pinHash);
        await scope.markActive({ recordId: record.id, userId, membershipId: granted.membershipId });
        await scope.appendEvent({
          employeeId: command.employeeId,
          userId,
          membershipId: granted.membershipId,
          branchId: record.branchId,
          role: record.roleCode,
        });
        return { kind: 'granted', membershipId: granted.membershipId, userId } as const;
      },
    );
  }
}

/** أنواع نطاق الخطوة الأولى كما تعود من الـ port — اختصار داخلي للملف. */
type BeginScope = GrantBeginScope;
