import { normalizeRecoveryEmail } from '../../domain/create-employee.ts';
import { StaffAccessError } from '../../domain/errors.ts';
import type {
  GrantBeginOutcome,
  GrantCommitOutcome,
  GrantCommitScope,
  GrantEmployeeAccessCommand,
  GrantEmployeeAccessSteps,
  StaffAccessActor,
  StaffAccessGrantCache,
  StaffAccessIds,
  StaffAccessUserSteps,
} from '../../ports/staff-access.port.ts';
import type { GrantBeginScope } from '../../ports/staff-access-begin.port.ts';
import {
  unlimitedStaffAccessGrantAdmission,
  type StaffAccessGrantAdmission,
} from '../../ports/staff-access-admission.port.ts';
import type { Clock } from '../../../../shared/ports/clock.port.ts';

export { StaffAccessError };

/** أنواع سجل الخطوة الأولى كما تعود من الـ port. */
type BeginRecord = GrantBeginOutcome['record'];
type BeginEmployee = GrantBeginOutcome['employee'];

/**
 * نتيجة المنح كاملة لبناء الرد بلا أي قراءة بعد الالتزام: الدور والفرع من السجل المقفول وآخر
 * ثلاثة أرقام من هاتف الطلب نفسه (null لو سجل ACTIVE سابق بهاتف مختلف).
 */
export type GrantEmployeeAccessResult = {
  readonly kind: 'already' | 'granted';
  readonly role: GrantEmployeeAccessCommand['role'];
  readonly branchId: string;
  readonly phoneLast3: string | null;
};

/** بيُنجز «إعطاء دخول» لموظفة على فرعها الأساسي بخطوات قابلة للاستئناف بمعرّف العملية (FR-F1-6). */
export class GrantEmployeeAccessUseCase {
  constructor(
    private readonly steps: GrantEmployeeAccessSteps,
    private readonly users: StaffAccessUserSteps,
    private readonly cache: StaffAccessGrantCache,
    private readonly clock: Clock,
    private readonly ids: StaffAccessIds,
    private readonly admission: StaffAccessGrantAdmission = unlimitedStaffAccessGrantAdmission,
  ) {}

  /**
   * بيشغّل الخطوات بالترتيب: قفل الشركة والموظفة وفحص السلطة قبل أي إجابة كاشفة (P1-1)، ثم
   * المستخدم على auth بمعرّف العملية، ثم العضوية والربط والرقم المؤقت والحدث في تراجع واحد،
   * وبعد الالتزام إبطال الكاش. الاستئناف يقارن الهاتف والدور والفرع بالسجل المقفول (P1-4).
   * فشل إبطال الكاش بعد الالتزام ما بيحوّلش منحة ملتومة لخطأ (AC-ACT-11).
   * قبل أول معاملة بتتحجز حصة المنح: منحة جارية لنفس الشركة أو تجاوز حد المنح الجارية بيرفض
   * بكود قابل لإعادة المحاولة من غير ما يفتح معاملة ولا يتصل بـ auth (AC-ACT-1).
   *
   * @param command الموظفة والدور والهاتف والرقم السري والمانح من الجلسة
   * @returns `already` لتكرار ناجح، أو `granted`، ومعهما الدور والفرع وآخر ثلاثة أرقام للرد
   */
  async execute(command: GrantEmployeeAccessCommand): Promise<GrantEmployeeAccessResult> {
    const slot = this.admission.admit(command.companyId);
    if (slot === null) throw new StaffAccessError('TRANSACTION_RETRY_REQUIRED');
    try {
      const begin = await this.#begin(command);
      const { userId } = await this.#provision(command, begin);
      const pinHash = await this.users.hash(command.pin);
      const outcome = await this.#commit(command, begin, userId, pinHash);
      // بعد الالتزام: إبطال الكاش خطوة مساعدة، وفشلها ما بيرجعش منحة ملتومة لخطأ (AC-ACT-11).
      if (outcome.kind === 'granted')
        await this.cache
          .invalidate({
            companyId: command.companyId,
            membershipId: outcome.membershipId,
          })
          .catch(() => undefined);
      return {
        kind: outcome.kind,
        role: outcome.role,
        branchId: outcome.branchId,
        phoneLast3:
          outcome.kind === 'already' && !outcome.phoneMatches ? null : command.phone.slice(-3),
      };
    } finally {
      this.admission.release(slot);
    }
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
        const recoveryEmail = normalizeRecoveryEmail(command.recoveryEmail);
        if (recoveryEmail !== null) await scope.setRecoveryEmail(recoveryEmail);
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
    if (record.state === 'STOPPED') {
      const restarted = await scope.restartRecord(record.id, {
        phoneHash: scope.phoneHash(command.phone),
        roleCode: command.role,
        branchId: employee.primaryBranchId,
      });
      return { record: restarted, employee };
    }
    const phoneMatches = scope.phoneHash(command.phone) === record.phoneHash;
    const roleMatches = record.roleCode === command.role;
    const branchMatches = record.branchId === employee.primaryBranchId;
    if (!phoneMatches || !roleMatches || !branchMatches)
      throw new StaffAccessError('STAFF_ACCESS_NOT_ALLOWED');
    return { record, employee };
  }

  /**
   * يعيد قفل السجل المثبت قبل auth حتى لا يبدأ إنشاء حساب بعد انتقال الإلغاء أو حذف السجل أو بدء
   * محاولة أحدث، ويعيد فحص سلطة المانح وربط الموظفة تحت قفل الشركة قبل أي كتابة في auth (P1-2).
   * هاتف مملوك مؤكد يحرر المحاولة في نفس المعاملة فلا تبقى الموظفة معلّقة 24 ساعة (E1).
   */
  async #provision(command: GrantEmployeeAccessCommand, begin: GrantBeginOutcome) {
    const actor = { companyId: command.companyId, userId: command.userId };
    const result = await this.steps.begin(
      actor,
      {
        businessId: command.businessId,
        employeeId: command.employeeId,
        ids: this.ids,
        at: this.clock.now(),
      },
      async (scope): Promise<{ userId: string } | null> => {
        if (!(await scope.lockCompany())) throw new StaffAccessError('EMPLOYEE_NOT_FOUND');
        const employee = await scope.lockEmployee();
        const record = await scope.findRecord();
        if (
          employee === null ||
          record === null ||
          record.id !== begin.record.id ||
          record.attemptId !== begin.record.attemptId ||
          !['PENDING', 'ACTIVE'].includes(record.state)
        )
          throw new StaffAccessError('STAFF_ACCESS_NOT_ALLOWED');
        await this.#assertStillEligible(scope, command, employee, record);
        await this.#reuseRecord(scope, command, employee, record);
        if (record.state === 'ACTIVE') {
          if (record.userId === null) throw new StaffAccessError('STAFF_ACCESS_NOT_ALLOWED');
          return { userId: record.userId };
        }
        return this.#provisionOrRelease(scope, command, { employee, record });
      },
    );
    if (result === null) throw new StaffAccessError('STAFF_ACCESS_PHONE_TAKEN');
    return result;
  }

  /** سلطة المانح وربط الموظفة كما في الخطوة الأولى لكن تحت القفل الحالي قبل لمس auth (P1-2). */
  async #assertStillEligible(
    scope: BeginScope,
    command: GrantEmployeeAccessCommand,
    employee: BeginEmployee,
    record: BeginRecord,
  ): Promise<void> {
    if (!(await scope.authority(employee.businessId, employee.primaryBranchId)))
      throw new StaffAccessError('STAFF_ACCESS_NOT_ALLOWED');
    if (employee.userId === command.userId) throw new StaffAccessError('STAFF_ACCESS_NOT_ALLOWED');
    if (employee.userId !== null && record.userId !== employee.userId)
      throw new StaffAccessError('STAFF_ACCESS_NOT_ALLOWED');
  }

  /** ينشئ حساب auth؛ رفض الهاتف المملوك المؤكد يحرر المحاولة ويعيد null ليُرفض الطلب بعد الالتزام. */
  async #provisionOrRelease(
    scope: BeginScope,
    command: GrantEmployeeAccessCommand,
    target: { employee: BeginEmployee; record: BeginRecord },
  ): Promise<{ userId: string } | null> {
    const { employee, record } = target;
    try {
      return await this.users.provision({
        operationId: record.operationId,
        companyId: command.companyId,
        actorUserId: command.userId,
        phone: command.phone,
        name: employee.displayName,
        ids: this.ids,
        recordState: 'PENDING',
        resetBinding: record.state === 'PENDING' && record.userId !== null,
        attemptId: record.attemptId,
      });
    } catch (error) {
      if (!(error instanceof StaffAccessError) || error.code !== 'STAFF_ACCESS_PHONE_TAKEN')
        throw error;
      if (await this.#noAccountWritten(record))
        await scope.releaseAttempt(record.id, record.attemptId);
      return null;
    }
  }

  /** سجل إعادة المنح له حساب سابق؛ سجل جديد لازم يثبت auth أنه بلا حساب، وأي غموض يُبقي السجل. */
  async #noAccountWritten(record: BeginRecord): Promise<boolean> {
    if (record.userId !== null) return true;
    try {
      return !(await this.users.accountExists(record.operationId));
    } catch {
      return false;
    }
  }

  /** الخطوة الثالثة: إعادة الفحص تحت القفل والإثبات عبر auth ثم الكتابة من السجل المقفول (P1-4/P1-5). */
  async #commit(
    command: GrantEmployeeAccessCommand,
    begin: GrantBeginOutcome,
    userId: string,
    pinHash: string,
  ): Promise<GrantCommitOutcome> {
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
      (scope) => this.#commitWork(scope, { command, begin, userId, pinHash }),
    );
  }

  async #commitWork(
    scope: GrantCommitScope,
    input: {
      command: GrantEmployeeAccessCommand;
      begin: GrantBeginOutcome;
      userId: string;
      pinHash: string;
    },
  ): Promise<GrantCommitOutcome> {
    const { command, begin, userId, pinHash } = input;
    if (!(await scope.lockCompany())) throw new StaffAccessError('EMPLOYEE_NOT_FOUND');
    const { employee, record } = await scope.recheck();
    if (employee === null || record === null) throw new StaffAccessError('EMPLOYEE_NOT_FOUND');
    if (
      employee.userId === command.userId ||
      (employee.userId !== null && employee.userId !== userId)
    )
      throw new StaffAccessError('STAFF_ACCESS_NOT_ALLOWED');
    if (!(await scope.authority(employee.businessId, employee.primaryBranchId)))
      throw new StaffAccessError('STAFF_ACCESS_NOT_ALLOWED');
    // المحاولة تُفحص قبل اختصار ACTIVE: طلب قديم لا يُنسب إليه نجاح محاولة أحدث (P1-1).
    if (record.attemptId !== begin.record.attemptId)
      throw new StaffAccessError('STAFF_ACCESS_NOT_ALLOWED');
    if (record.state === 'ACTIVE')
      return {
        kind: 'already',
        role: record.roleCode,
        branchId: record.branchId,
        phoneMatches: record.phoneHash === begin.record.phoneHash,
      };
    if (
      record.state !== 'PENDING' ||
      record.operationId !== begin.record.operationId ||
      record.phoneHash !== begin.record.phoneHash ||
      record.branchId !== employee.primaryBranchId
    )
      throw new StaffAccessError('STAFF_ACCESS_NOT_ALLOWED');
    const granted = await scope.grantMembership({
      operationId: record.operationId,
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
    return {
      kind: 'granted',
      membershipId: granted.membershipId,
      userId,
      role: record.roleCode,
      branchId: record.branchId,
    };
  }
}

/** أنواع نطاق الخطوة الأولى كما تعود من الـ port — اختصار داخلي للملف. */
type BeginScope = GrantBeginScope;
