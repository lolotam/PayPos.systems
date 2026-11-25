import { StaffAccessError } from '../../domain/errors.ts';
import type { StaffAccessRecordRow } from '../../domain/staff-access.ts';
import type {
  ChangeEmployeeStaffPhoneCommand,
  ChangeEmployeeStaffPhoneScope,
  ChangeEmployeeStaffPhoneSteps,
  ChangeStaffPhoneBegin,
  ChangeStaffPhoneResult,
  StaffAccessActor,
  StaffAccessGrantCache,
  StaffAccessIds,
  StaffAccessPhoneUserSteps,
} from '../../ports/staff-access.port.ts';
import type { Clock } from '../../../../shared/ports/clock.port.ts';

/** الخطوة الأولى والثالثة تأخذ نفس نطاق المعاملة — اختصار داخلي للملف. */
type Scope = ChangeEmployeeStaffPhoneScope;

/**
 * تغيير هاتف موظفة لها دخول فعّال على فرعها الأساسي من غير نفسها (F3-1) بثلاث خطوات قابلة
 * للاستئناف: معاملة الشركة تمسح الرقم السري وتنقل السجل إلى PHONE_CHANGING، ثم معاملة auth تغيّر الهاتف
 * وتنهي الجلسات، ثم معاملة الشركة تحفظ الرقم المؤقت الجديد وتعيد السجل إلى ACTIVE. أي انقطاع بعد
 * الخطوة الأولى يترك PHONE_CHANGING فيُكمله الطلب نفسه عند تكراره (بلا أي دخول قديم يعمل بينهم).
 */
export class ChangeEmployeeStaffPhoneUseCase {
  constructor(
    private readonly steps: ChangeEmployeeStaffPhoneSteps,
    private readonly users: StaffAccessPhoneUserSteps,
    private readonly cache: StaffAccessGrantCache,
    private readonly clock: Clock,
    private readonly ids: StaffAccessIds,
  ) {}

  /**
   * يشغّل الخطوات الثلاث بالترتيب؛ السلطة والرفضات (الموظفة نفسها، غير موظفة دخول، حالة غير
   * ACTIVE/PHONE_CHANGING) قبل أي كتابة، وتصوير الرقم السري بعد خطوة auth وبره المعاملات. فشل إبطال الكاش
   * بعد الالتزام ما بيحوّلش تغييراً ملتزماً لخطأ.
   *
   * @param command الموظفة والهاتف الجديد والرقم السري والمانح من الجلسة
   * @returns الدور والفرع وآخر ثلاثة أرقام من الهاتف الجديد من السجل المقفول
   */
  async execute(command: ChangeEmployeeStaffPhoneCommand): Promise<ChangeStaffPhoneResult> {
    const actor: StaffAccessActor = { companyId: command.companyId, userId: command.userId };
    const begin = await this.#run(actor, command, (scope) => this.#begin(scope, command));
    await this.users.changePhone({
      operationId: begin.operationId,
      companyId: command.companyId,
      userId: begin.userId,
      phone: command.phone,
      actorUserId: command.userId,
      attemptId: begin.attemptId,
      ids: this.ids,
    });
    const pinHash = await this.users.hash(command.pin);
    const result = await this.#run(actor, command, (scope) =>
      this.#commit(scope, command, begin, pinHash),
    );
    if (result.kind === 'changed')
      await this.cache
        .invalidate({ companyId: command.companyId, membershipId: begin.membershipId })
        .catch(() => undefined);
    return result;
  }

  #run<T>(
    actor: StaffAccessActor,
    command: ChangeEmployeeStaffPhoneCommand,
    work: (scope: Scope) => Promise<T>,
  ): Promise<T> {
    return this.steps.run(
      actor,
      {
        businessId: command.businessId,
        employeeId: command.employeeId,
        ids: this.ids,
        at: this.clock.now(),
      },
      work,
    );
  }

  /** الخطوة الأولى: القفل والسلطة والرفضات، ثم مسح الرقم السري ونقل السجل إلى PHONE_CHANGING. */
  async #begin(
    scope: Scope,
    command: ChangeEmployeeStaffPhoneCommand,
  ): Promise<ChangeStaffPhoneBegin> {
    const { record } = await this.#lockedAuthorised(scope, command);
    if (record.state !== 'ACTIVE' && record.state !== 'PHONE_CHANGING')
      throw new StaffAccessError('STAFF_ACCESS_NOT_ALLOWED');
    if (record.membershipId === null) throw new StaffAccessError('STAFF_ACCESS_NOT_ALLOWED');
    const phoneHash = scope.phoneHash(command.phone);
    // الاستئناف بنفس الهاتف يحتفظ بالمحاولة فيتلاقى الطلبان المتطابقان على أثر واحد؛ هاتف مختلف محاولة جديدة.
    const resumeAttempt =
      record.state === 'PHONE_CHANGING' && record.phoneHash === phoneHash ? record.attemptId : null;
    const attemptId = await scope.startChange({
      recordId: record.id,
      userId: record.userId,
      phoneHash,
      resumeAttempt,
    });
    return {
      recordId: record.id,
      operationId: record.operationId,
      userId: record.userId,
      membershipId: record.membershipId,
      role: record.roleCode,
      branchId: record.branchId,
      attemptId,
      phoneHash,
    };
  }

  /**
   * القفل والسلطة ورفض الموظفة نفسها وغير موظفة الدخول — مشتركة بين الخطوتين الأولى والثالثة.
   * الموظفة والسجل يرجعان غير null بعد المرور.
   */
  async #lockedAuthorised(
    scope: Scope,
    command: ChangeEmployeeStaffPhoneCommand,
  ): Promise<{ record: StaffAccessRecordRow & { userId: string } }> {
    if (!(await scope.lockCompany())) throw new StaffAccessError('EMPLOYEE_NOT_FOUND');
    const { employee, record } = await scope.lock();
    if (employee === null) throw new StaffAccessError('EMPLOYEE_NOT_FOUND');
    if (!(await scope.authority(employee.businessId, employee.primaryBranchId)))
      throw new StaffAccessError('STAFF_ACCESS_NOT_ALLOWED');
    // الموظفة ما بتغيّرش هاتفها بنفسها، والحساب لازم يكون حساب دخول موظفة مربوط بسجلها.
    if (employee.userId === command.userId) throw new StaffAccessError('STAFF_ACCESS_NOT_ALLOWED');
    if (record === null || record.userId === null || record.userId !== employee.userId)
      throw new StaffAccessError('STAFF_ACCESS_NOT_ALLOWED');
    return { record: { ...record, userId: record.userId } };
  }

  /**
   * الخطوة الثالثة: إعادة الفحص تحت القفل وأن السجل ما زال في المحاولة نفسها، ثم الرقم المؤقت
   * وACTIVE والتدقيق والحدث. سجل ACTIVE بالمحاولة والبصمة نفسيهما يعني أن طلباً متطابقاً سبقنا فلا كتابة.
   */
  async #commit(
    scope: Scope,
    command: ChangeEmployeeStaffPhoneCommand,
    begin: ChangeStaffPhoneBegin,
    pinHash: string,
  ): Promise<ChangeStaffPhoneResult> {
    const { record } = await this.#lockedAuthorised(scope, command);
    const sameAttempt =
      record.id === begin.recordId &&
      record.userId === begin.userId &&
      record.attemptId === begin.attemptId &&
      record.phoneHash === begin.phoneHash;
    if (!sameAttempt) throw new StaffAccessError('STAFF_ACCESS_NOT_ALLOWED');
    const result = {
      role: record.roleCode,
      branchId: record.branchId,
      phoneLast3: command.phone.slice(-3),
    };
    if (record.state === 'ACTIVE') return { kind: 'already', ...result };
    if (record.state !== 'PHONE_CHANGING') throw new StaffAccessError('STAFF_ACCESS_NOT_ALLOWED');
    await scope.completeChange({ recordId: record.id, userId: begin.userId, pinHash });
    await scope.appendEvent({
      employeeId: command.employeeId,
      userId: begin.userId,
      branchId: record.branchId,
    });
    return { kind: 'changed', ...result };
  }
}
