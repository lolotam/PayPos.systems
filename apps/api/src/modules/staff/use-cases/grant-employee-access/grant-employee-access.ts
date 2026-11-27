import { normalizeRecoveryEmail } from '../../domain/create-employee.ts';
import { StaffAccessError } from '../../domain/errors.ts';
import {
  resolveAdditionalStaffBranches,
  sameAdditionalStaffBranches,
  type StaffAccessBranchAssignment,
} from '../../domain/staff-access.ts';
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
import { AttemptOverrideBinding, canonicalOverrideKey } from './override-binding.ts';
import {
  applyGrantOverrides,
  assertExtraGrantAuthority,
  assertPrimaryGrantAuthority,
  grantMemberships,
} from './grant-commit-steps.ts';

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
  /**
   * استثناءات الصلاحيات المربوطة بكل محاولة منحة: بصمة الاستثناءات وأصحابها. الطلب اللي
   * يستأنف محاولة معلّقة لازم يجيب نفس الاستثناءات — تغييرها في نص المحاولة مرفوض عشان
   * الاستثناء اللي اتكتب في محاولة ما يتقارنش بعرض تاني. البصمة بتتحرر بانتهاء المحاولة عشان
   * إعادة المحاولة باستثناءات مصححة تنجح، والمحاولات المتزامنة لنفس البصمة ما تشيلش بعضها.
   */
  readonly #attemptOverrides = new AttemptOverrideBinding();

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
    // كل محاولة جارية لها صاحب واحد: بصمة الاستثناءات بتتحرر لصاحبها بس، فمحاولتين
    // متزامنتين بنفس البصمة ما تشيلش بعضها، والمحاولة اللي فشلتت ما بتسيبش بصمة ورا.
    const owner = Symbol('staff-access-grant');
    try {
      const begin = await this.#begin(command, owner);
      const { userId } = await this.#provision(command, begin, owner);
      const pinHash = await this.users.hash(command.pin);
      const outcome = await this.#commit(command, begin, userId, pinHash);
      // بعد الالتزام: إبطال الكاش خطوة مساعدة، وفشلها ما بيرجعش منحة ملتومة لخطأ (AC-ACT-11).
      if (outcome.kind === 'granted')
        for (const membershipId of [outcome.membershipId, ...outcome.extraMembershipIds])
          await this.cache
            .invalidate({ companyId: command.companyId, membershipId })
            .catch(() => undefined);
      return {
        kind: outcome.kind,
        role: outcome.role,
        branchId: outcome.branchId,
        phoneLast3:
          outcome.kind === 'already' && !outcome.phoneMatches ? null : command.phone.slice(-3),
      };
    } finally {
      // المحاولة خلصت — بنجاح أو برفض: بصمة الاستثناءات بتتحرر لصاحبها عشان إعادة المحاولة
      // باستثناءات مصححة تنجح، والمحاولات المتزامنة لنفس البصمة ما تشيلش بعضها.
      this.#attemptOverrides.release(owner);
      this.admission.release(slot);
    }
  }

  /** الخطوة الأولى: الشركة ← الموظفة (P1-3)، والسلطة قبل أي رفض كاشف بالحالة (P1-1). */
  async #begin(command: GrantEmployeeAccessCommand, owner: symbol): Promise<GrantBeginOutcome> {
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
        const extraBranches = await this.#resolveExtraBranches(scope, command, employee);
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
        if (record !== null)
          return this.#reuseRecord(scope, command, employee, record, extraBranches, owner);
        const inserted = await scope.insertRecord({
          roleCode: command.role,
          branchId: employee.primaryBranchId,
          phoneHash: scope.phoneHash(command.phone),
          extraBranches,
        });
        this.#attemptOverrides.bind(
          inserted.attemptId,
          canonicalOverrideKey(command.permissionOverrides),
          owner,
        );
        return { record: inserted, employee };
      },
    );
  }

  /**
   * يسوّي الفروع الإضافية المطلوبة ويفحص سلطة المانح على كل فرع منها (080-b): فرع غريب أو
   * مش من النشاط بيرفض زي ما بيرفض الفرع الأساسي، وما بياخدش خطوة auth.
   */
  async #resolveExtraBranches(
    scope: GrantBeginScope,
    command: GrantEmployeeAccessCommand,
    employee: BeginEmployee,
  ): Promise<readonly StaffAccessBranchAssignment[]> {
    const resolved = resolveAdditionalStaffBranches(
      employee.primaryBranchId,
      command.role,
      command.additionalBranches,
    );
    if (!resolved.ok) throw new StaffAccessError(resolved.refusal);
    for (const extra of resolved.branches)
      if (!(await scope.authority(employee.businessId, extra.branchId)))
        throw new StaffAccessError('STAFF_ACCESS_NOT_ALLOWED');
    return resolved.branches;
  }

  /** استئناف سجل قائم: الهاتف والدور والفرع والفروع لازم يطابقوا السجل المقفول — أي خلاف رفض بلا تفاصيل (P1-4). */
  async #reuseRecord(
    scope: BeginScope,
    command: GrantEmployeeAccessCommand,
    employee: BeginEmployee,
    record: BeginRecord,
    extraBranches: readonly StaffAccessBranchAssignment[],
    owner: symbol,
  ): Promise<GrantBeginOutcome> {
    const canonical = canonicalOverrideKey(command.permissionOverrides);
    if (record.state === 'STOPPED') {
      const restarted = await scope.restartRecord(record.id, {
        phoneHash: scope.phoneHash(command.phone),
        roleCode: command.role,
        branchId: employee.primaryBranchId,
        extraBranches,
      });
      // المحاولة الجديدة بتاخد بصمة الاستثناءات الجديدة، وبصمة المحاولة القديمة بتتشال.
      this.#attemptOverrides.release(owner);
      this.#attemptOverrides.bind(restarted.attemptId, canonical, owner);
      return { record: restarted, employee };
    }
    const phoneMatches = scope.phoneHash(command.phone) === record.phoneHash;
    const roleMatches = record.roleCode === command.role;
    const branchMatches = record.branchId === employee.primaryBranchId;
    const savedExtras = await scope.findExtraBranches(record.id);
    const extrasMatch = sameAdditionalStaffBranches(savedExtras, extraBranches);
    if (!phoneMatches || !roleMatches || !branchMatches || !extrasMatch)
      throw new StaffAccessError('STAFF_ACCESS_NOT_ALLOWED');
    // استئناف محاولة معلّقة: الاستثناءات لازم تكون نفسها اللي اتربطت بالمحاولة، وإلا
    // الاستثناء اللي اتكتب في محاولة ما يتقارنش بعرض تاني. المحاولة اللي فشلتت بصمتها
    // اتحررت، فإعادة المحاولة باستثناءات مصححة بتعدّي.
    const bound = this.#attemptOverrides.keyOf(record.attemptId);
    if (bound !== null && bound !== canonical)
      throw new StaffAccessError('STAFF_ACCESS_NOT_ALLOWED');
    this.#attemptOverrides.bind(record.attemptId, canonical, owner);
    return { record, employee };
  }

  /**
   * يعيد قفل السجل المثبت قبل auth حتى لا يبدأ إنشاء حساب بعد انتقال الإلغاء أو حذف السجل أو بدء
   * محاولة أحدث، ويعيد فحص سلطة المانح وربط الموظفة تحت قفل الشركة قبل أي كتابة في auth (P1-2).
   * هاتف مملوك مؤكد يحرر المحاولة في نفس المعاملة فلا تبقى الموظفة معلّقة 24 ساعة (E1).
   */
  async #provision(command: GrantEmployeeAccessCommand, begin: GrantBeginOutcome, owner: symbol) {
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
        const extraBranches = await this.#resolveExtraBranches(scope, command, employee);
        await this.#reuseRecord(scope, command, employee, record, extraBranches, owner);
        if (record.state === 'ACTIVE') {
          if (record.userId === null) throw new StaffAccessError('STAFF_ACCESS_NOT_ALLOWED');
          return { userId: record.userId };
        }
        return this.#provisionOrRelease(scope, command, { employee, record }, owner);
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
    owner: symbol,
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
      if (await this.#noAccountWritten(record)) {
        await scope.releaseAttempt(record.id, record.attemptId);
        this.#attemptOverrides.release(owner);
      }
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
    const outcome = await this.steps.commit(
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
    return outcome;
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
    const { employee, record, extraBranches } = await scope.recheck();
    if (employee === null || record === null) throw new StaffAccessError('EMPLOYEE_NOT_FOUND');
    if (
      employee.userId === command.userId ||
      (employee.userId !== null && employee.userId !== userId)
    )
      throw new StaffAccessError('STAFF_ACCESS_NOT_ALLOWED');
    await assertPrimaryGrantAuthority(scope, employee);
    // التكرار الناجح بيتقفل قبل فحص الفروع الإضافية (080-b): الطلب المكرر لنفس المحاولة
    // بيرد بنفس النتيجة من غير ما يتأثر بسلطة فرع إضافي اتغيّر.
    const already = this.#alreadyOutcome(record, begin);
    if (already !== null) return already;
    // سلطة المانح على كل فرع إضافي بتفحص جوّه نفس المعاملة (080-b).
    await assertExtraGrantAuthority(scope, employee, extraBranches);
    this.#assertPendingRecord(record, begin, employee);
    const memberships = await grantMemberships(
      scope,
      command,
      userId,
      employee,
      record,
      extraBranches,
    );
    if (employee.userId !== userId) await scope.linkEmployee(userId);
    await scope.saveTemporaryPin(userId, pinHash);
    await scope.markActive({
      recordId: record.id,
      userId,
      membershipId: memberships.primary.membershipId,
    });
    await scope.appendEvent({
      employeeId: command.employeeId,
      userId,
      membershipId: memberships.primary.membershipId,
      branchId: record.branchId,
      role: record.roleCode,
    });
    await applyGrantOverrides(scope, command, {
      membershipId: memberships.primary.membershipId,
      branchId: record.branchId,
      role: record.roleCode,
      extras: memberships.extras,
    });
    return {
      kind: 'granted',
      membershipId: memberships.primary.membershipId,
      extraMembershipIds: memberships.extras.map((extra) => extra.membershipId),
      userId,
      role: record.roleCode,
      branchId: record.branchId,
    };
  }

  /**
   * تكرار ناجح: السجل ACTIVE بنفس المحاولة — الرد من السجل المقفول بلا قراءة تالية.
   * المحاولة تُفحص قبل الاختصار: طلب قديم لا يُنسب إليه نجاح محاولة أحدث (P1-1).
   */
  #alreadyOutcome(
    record: NonNullable<Awaited<ReturnType<GrantCommitScope['recheck']>>['record']>,
    begin: GrantBeginOutcome,
  ): GrantCommitOutcome | null {
    if (record.attemptId !== begin.record.attemptId)
      throw new StaffAccessError('STAFF_ACCESS_NOT_ALLOWED');
    if (record.state !== 'ACTIVE') return null;
    return {
      kind: 'already',
      role: record.roleCode,
      branchId: record.branchId,
      phoneMatches: record.phoneHash === begin.record.phoneHash,
    };
  }

  /** السجل لازم يكون PENDING بنفس العملية والهاتف والفرع — أي خلاف رفض بلا تفاصيل (P1-4). */
  #assertPendingRecord(
    record: NonNullable<Awaited<ReturnType<GrantCommitScope['recheck']>>['record']>,
    begin: GrantBeginOutcome,
    employee: NonNullable<Awaited<ReturnType<GrantCommitScope['recheck']>>['employee']>,
  ): void {
    if (
      record.state !== 'PENDING' ||
      record.operationId !== begin.record.operationId ||
      record.phoneHash !== begin.record.phoneHash ||
      record.branchId !== employee.primaryBranchId
    )
      throw new StaffAccessError('STAFF_ACCESS_NOT_ALLOWED');
  }
}

/** أنواع نطاق الخطوة الأولى كما تعود من الـ port — اختصار داخلي للملف. */
type BeginScope = GrantBeginScope;
