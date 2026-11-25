import { StaffAccessError } from '../../domain/errors.ts';
import type {
  ResetEmployeeStaffPinCommand,
  ResetEmployeeStaffPinScope,
  ResetEmployeeStaffPinSteps,
  StaffAccessActor,
  StaffAccessIds,
  StaffAccessUserSteps,
} from '../../ports/staff-access.port.ts';
import type { Clock } from '../../../../shared/ports/clock.port.ts';

/**
 * نتيجة إعادة الضبط: الدور والفرع والمستخدم من السجل المقفول — الرد بلا أي قراءة بعد
 * الالتزام، فضمان ملتزم ما يتحوّلش لخطأ.
 */
export interface ResetEmployeeStaffPinResult {
  readonly role: 'staff' | 'reception';
  readonly branchId: string;
  readonly userId: string;
}

/**
 * إعادة ضبط الرقم السري لموظفة على فرعها الأساسي من غير نفسها (F2b): الرقم الجديد مؤقت
 * وينتهي بعد 24 ساعة، والسلطة (`manage:staff-access:branch`) بتتفحص على فرع الموظفة
 * الأساسي جوه نفس المعاملة — فسحب الصلاحية أثناء المعاملة ما يعديش.
 */
export class ResetEmployeeStaffPinUseCase {
  constructor(
    private readonly steps: ResetEmployeeStaffPinSteps,
    private readonly users: StaffAccessUserSteps,
    private readonly clock: Clock,
    private readonly ids: StaffAccessIds,
  ) {}

  /**
   * يصوّر الرقم السري بره المعاملة (التصوير بطيء مقصود)، ثم قفل الشركة والموظفة والسجل
   * وفحص السلطة، فالرفضات (نفس الموظفة، أو موظفة مش موظفة دخول، أو سجل مش ACTIVE) قبل
   * أي كتابة، وبعدها الرقم المؤقت والتدقيق والحدث في معاملة واحدة.
   *
   * @param command الموظفة والرقم السري الجديد والمانح من الجلسة
   * @returns الدور والفرع والمستخدم من السجل المقفول
   */
  async execute(command: ResetEmployeeStaffPinCommand): Promise<ResetEmployeeStaffPinResult> {
    const pinHash = await this.users.hash(command.pin);
    const actor: StaffAccessActor = { companyId: command.companyId, userId: command.userId };
    return this.steps.run(
      actor,
      {
        businessId: command.businessId,
        employeeId: command.employeeId,
        ids: this.ids,
        at: this.clock.now(),
      },
      (scope) => this.#reset(scope, command, pinHash),
    );
  }

  /** القفل ثم فحص السلطة ثم الرفضات، وبعدها الكتابة كلها في نفس المعاملة. */
  async #reset(
    scope: ResetEmployeeStaffPinScope,
    command: ResetEmployeeStaffPinCommand,
    pinHash: string,
  ): Promise<ResetEmployeeStaffPinResult> {
    if (!(await scope.lockCompany())) throw new StaffAccessError('EMPLOYEE_NOT_FOUND');
    const { employee, record } = await scope.lock();
    if (employee === null) throw new StaffAccessError('EMPLOYEE_NOT_FOUND');
    if (!(await scope.authority(employee.businessId, employee.primaryBranchId)))
      throw new StaffAccessError('STAFF_ACCESS_NOT_ALLOWED');
    // الموظفة ما بتضبطش رقمها بنفسها: المنح نفسه بيرفض كده.
    if (employee.userId === command.userId) throw new StaffAccessError('STAFF_ACCESS_NOT_ALLOWED');
    // الحساب لازم يكون حساب دخول موظفة مربوط بالسجل نفسه.
    if (record === null || record.userId === null || record.userId !== employee.userId)
      throw new StaffAccessError('STAFF_ACCESS_NOT_ALLOWED');
    if (record.state !== 'ACTIVE') throw new StaffAccessError('STAFF_ACCESS_NOT_ALLOWED');
    await scope.saveTemporaryPin(record.userId, pinHash);
    await scope.appendEvent({
      employeeId: command.employeeId,
      userId: record.userId,
      branchId: record.branchId,
    });
    return { role: record.roleCode, branchId: record.branchId, userId: record.userId };
  }
}
