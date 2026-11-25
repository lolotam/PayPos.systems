import { StaffAccessError } from '../../domain/errors.ts';
import type {
  StaffAccessActor,
  StaffAccessGrantCache,
  StaffAccessIds,
  StaffAccessSessionEnder,
  StopEmployeeStaffAccessCommand,
  StopEmployeeStaffAccessResult,
  StopEmployeeStaffAccessScope,
  StopEmployeeStaffAccessSteps,
} from '../../ports/staff-access.port.ts';
import type { Clock } from '../../../../shared/ports/clock.port.ts';

/**
 * إيقاف دخول موظفة لها دخول فعّال على فرعها الأساسي من غير نفسها (F3-2): معاملة الشركة تنهي العضوية
 * فوراً وتمسح الرقم السري وتنقل السجل إلى STOPPED وتُبقي `employees.user_id`، ثم بعد الالتزام تُنهى
 * جلساتها على auth ويُبطَل كاش المنح. فشل أيٍّ من الخطوتين الأخيرتين لا يُبطل إيقافاً ملتزماً:
 * فحص الأهلية يرفض طلبها التالي من السجل نفسه.
 */
export class StopEmployeeStaffAccessUseCase {
  constructor(
    private readonly steps: StopEmployeeStaffAccessSteps,
    private readonly sessions: StaffAccessSessionEnder,
    private readonly cache: StaffAccessGrantCache,
    private readonly clock: Clock,
    private readonly ids: StaffAccessIds,
  ) {}

  /**
   * القفل والسلطة والرفضات قبل أي كتابة، ثم الإيقاف في المعاملة، ثم الجلسات والكاش بعد الالتزام.
   *
   * @param command الموظفة والمانح من الجلسة
   * @returns الدور والفرع من السجل المقفول
   */
  async execute(command: StopEmployeeStaffAccessCommand): Promise<StopEmployeeStaffAccessResult> {
    const actor: StaffAccessActor = { companyId: command.companyId, userId: command.userId };
    const stopped = await this.steps.run(
      actor,
      {
        businessId: command.businessId,
        employeeId: command.employeeId,
        ids: this.ids,
        at: this.clock.now(),
      },
      (scope) => this.#stop(scope, command),
    );
    await this.sessions
      .deleteSessions({
        operationId: stopped.operationId,
        companyId: command.companyId,
        userId: stopped.userId,
      })
      .catch(() => undefined);
    await this.cache
      .invalidate({ companyId: command.companyId, membershipId: stopped.membershipId })
      .catch(() => undefined);
    return { role: stopped.role, branchId: stopped.branchId };
  }

  /** القفل والسلطة والرفضات ثم الإيقاف داخل المعاملة؛ يرجع ما تحتاجه خطوات ما بعد الالتزام. */
  async #stop(scope: StopEmployeeStaffAccessScope, command: StopEmployeeStaffAccessCommand) {
    if (!(await scope.lockCompany())) throw new StaffAccessError('EMPLOYEE_NOT_FOUND');
    const { employee, record } = await scope.lock();
    if (employee === null) throw new StaffAccessError('EMPLOYEE_NOT_FOUND');
    if (!(await scope.authority(employee.businessId, employee.primaryBranchId)))
      throw new StaffAccessError('STAFF_ACCESS_NOT_ALLOWED');
    // الموظفة ما بتوقفش دخولها بنفسها، والإيقاف لسجل ACTIVE فقط بحساب مربوط بالموظفة نفسها.
    if (
      employee.userId === command.userId ||
      record === null ||
      record.state !== 'ACTIVE' ||
      record.userId === null ||
      record.membershipId === null ||
      record.userId !== employee.userId ||
      record.userId === command.userId
    )
      throw new StaffAccessError('STAFF_ACCESS_NOT_ALLOWED');
    await scope.stop({
      recordId: record.id,
      userId: record.userId,
      membershipId: record.membershipId,
    });
    return {
      operationId: record.operationId,
      userId: record.userId,
      membershipId: record.membershipId,
      role: record.roleCode,
      branchId: record.branchId,
    };
  }
}
