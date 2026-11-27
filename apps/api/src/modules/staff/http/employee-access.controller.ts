import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Param,
  Post,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  changeEmployeeStaffPhoneInput,
  grantStaffAccessInput,
  resetEmployeeStaffPinInput,
  staffAccessState,
  type ChangeEmployeeStaffPhoneInput,
  type GrantStaffAccessInput,
  type ResetEmployeeStaffPinInput,
  id,
} from '@pospay/contracts';
import { StaffAuthBusyError, type TenantWrappers } from '@pospay/db';
import type { FastifyRequest } from 'fastify';

import { Authenticated } from '../../../shared/access.decorators.ts';
import { DATABASE } from '../../../shared/database.token.ts';
import { actorOf } from '../../../shared/actor.ts';
import { ApiError } from '../../../shared/errors.ts';
import { SelectedCompanyGuard } from '../../../shared/selected-company.guard.ts';
import { ZodValidationPipe } from '../../../shared/zod-validation.pipe.ts';
import {
  EMPLOYEE_ACCESS_STATE_READS,
  readEmployeeStaffAccess,
  readGrantedEmployeeStaffAccess,
  type EmployeeAccessStateReads,
} from '../queries/employee-staff-access.query.ts';
import {
  StaffAccessError,
  GrantEmployeeAccessUseCase,
} from '../use-cases/grant-employee-access/grant-employee-access.ts';
import {
  CancelPendingStaffAccessUseCase,
  type CancelPendingStaffAccessOutcome,
} from '../use-cases/cancel-pending-staff-access/cancel-pending-staff-access.ts';
import { ResetEmployeeStaffPinUseCase } from '../use-cases/reset-employee-staff-pin/reset-employee-staff-pin.ts';
import { ChangeEmployeeStaffPhoneUseCase } from '../use-cases/change-employee-staff-phone/change-employee-staff-phone.ts';
import { StopEmployeeStaffAccessUseCase } from '../use-cases/stop-employee-staff-access/stop-employee-staff-access.ts';

/** بوابة التفعيل (FR-F1-9): تُقرأ مرة واحدة عند التشغيل من STAFF_ACCESS_ROUTES، وكل المسارات ترد 503 بدونها. */
export const STAFF_ACCESS_ROUTES_ENABLED = Symbol('STAFF_ACCESS_ROUTES_ENABLED');

/** رفض الدومين وفشل auth العابر إلى ApiError؛ غير ذلك يبقى كما هو ليتحول إلى 500 حقيقي. */
function staffAccessApiError(error: unknown): unknown {
  if (error instanceof StaffAccessError) return new ApiError(error.code);
  if (error instanceof StaffAuthBusyError) return new ApiError('TRANSACTION_RETRY_REQUIRED');
  return error;
}

@Controller('businesses/:businessId/employees/:employeeId')
export class EmployeeAccessController {
  constructor(
    @Inject(STAFF_ACCESS_ROUTES_ENABLED) private readonly enabled: boolean,
    @Inject(DATABASE) private readonly database: TenantWrappers | null,
    @Inject(GrantEmployeeAccessUseCase)
    private readonly grantUseCase: GrantEmployeeAccessUseCase | null,
    @Inject(CancelPendingStaffAccessUseCase)
    private readonly cancelUseCase: CancelPendingStaffAccessUseCase | null,
    @Inject(ResetEmployeeStaffPinUseCase)
    private readonly resetUseCase: ResetEmployeeStaffPinUseCase | null,
    @Inject(ChangeEmployeeStaffPhoneUseCase)
    private readonly phoneUseCase: ChangeEmployeeStaffPhoneUseCase | null,
    @Inject(StopEmployeeStaffAccessUseCase)
    private readonly stopUseCase: StopEmployeeStaffAccessUseCase | null,
    @Inject(EMPLOYEE_ACCESS_STATE_READS)
    private readonly reads: EmployeeAccessStateReads | null,
  ) {}

  /** إعطاء الدخول: الخيارات صارمة والقرار كله داخل المعاملات؛ الرد هو الحالة بعد الالتزام. */
  @Post('staff-access')
  @Authenticated()
  @UseGuards(SelectedCompanyGuard)
  @HttpCode(200)
  async grant(
    @Param('businessId', new ZodValidationPipe(id)) businessId: string,
    @Param('employeeId', new ZodValidationPipe(id)) employeeId: string,
    @Body(new ZodValidationPipe(grantStaffAccessInput)) input: GrantStaffAccessInput,
    @Req() request: FastifyRequest,
  ): Promise<unknown> {
    const actor = actorOf(request);
    this.ready();
    try {
      const granted = await (this.grantUseCase as GrantEmployeeAccessUseCase).execute({
        ...actor,
        businessId,
        employeeId,
        role: input.role,
        phone: input.phone,
        pin: input.pin,
        recoveryEmail: input.recovery_email,
        additionalBranches: input.additional_branches?.map((branch) => ({
          branchId: branch.branch_id,
          role: branch.role,
        })),
        permissionOverrides: input.permission_overrides,
      });
      // الرد من نتيجة المعاملة الملتزمة نفسها: لا قراءة تالية (معاملة جديدة ومكالمة auth) قد تفشل
      // فتحوّل منحاً ملتزماً إلى 500. الحالة بعد المنح ACTIVE دائماً.
      return staffAccessState.parse({
        state: 'ACTIVE',
        role: granted.role,
        branch_id: granted.branchId,
        phone_last3: granted.phoneLast3,
        can_manage: true,
        can_cancel: false,
      });
    } catch (error) {
      throw staffAccessApiError(error);
    }
  }

  /**
   * إعادة ضبط الرقم السري لموظفة على فرعها الأساسي: الرقم الجديد مؤقت وينتهي بعد 24 ساعة،
   * والسلطة بتتفحص على فرعها جوه معاملة الكتابة نفسها. الموظفة ما بتضبطش رقمها بنفسها.
   */
  @Post('staff-access/pin')
  @Authenticated()
  @UseGuards(SelectedCompanyGuard)
  @HttpCode(200)
  async resetPin(
    @Param('businessId', new ZodValidationPipe(id)) businessId: string,
    @Param('employeeId', new ZodValidationPipe(id)) employeeId: string,
    @Body(new ZodValidationPipe(resetEmployeeStaffPinInput)) input: ResetEmployeeStaffPinInput,
    @Req() request: FastifyRequest,
  ): Promise<unknown> {
    const actor = actorOf(request);
    this.ready();
    try {
      const reset = await (this.resetUseCase as ResetEmployeeStaffPinUseCase).execute({
        ...actor,
        businessId,
        employeeId,
        pin: input.pin,
      });
      // الرد من السجل المقفول: بلا قراءة تالية بعد الالتزام، وبلا آخر ثلاثة أرقام لأن الهاتف
      // على auth وما ينفعش يتقرا بعد ما المعاملة تلتزم.
      return staffAccessState.parse({
        state: 'ACTIVE',
        role: reset.role,
        branch_id: reset.branchId,
        phone_last3: null,
        can_manage: true,
        can_cancel: false,
      });
    } catch (error) {
      throw staffAccessApiError(error);
    }
  }

  /**
   * تغيير هاتف موظفة لها دخول فعّال: الرقم السري مؤقت وجديد، والجلسات القديمة والرقم القديم لا يعملان
   * من أول خطوة. الاستئناف بعد الانقطاع بنفس الطلب. الرد هو الحالة من نتيجة المعاملة الملتزمة.
   */
  @Put('staff-access/phone')
  @Authenticated()
  @UseGuards(SelectedCompanyGuard)
  @HttpCode(200)
  async changePhone(
    @Param('businessId', new ZodValidationPipe(id)) businessId: string,
    @Param('employeeId', new ZodValidationPipe(id)) employeeId: string,
    @Body(new ZodValidationPipe(changeEmployeeStaffPhoneInput))
    input: ChangeEmployeeStaffPhoneInput,
    @Req() request: FastifyRequest,
  ): Promise<unknown> {
    const actor = actorOf(request);
    this.ready();
    try {
      const changed = await (this.phoneUseCase as ChangeEmployeeStaffPhoneUseCase).execute({
        ...actor,
        businessId,
        employeeId,
        phone: input.phone,
        pin: input.pin,
      });
      return staffAccessState.parse({
        state: 'ACTIVE',
        role: changed.role,
        branch_id: changed.branchId,
        phone_last3: changed.phoneLast3,
        can_manage: true,
        can_cancel: false,
      });
    } catch (error) {
      throw staffAccessApiError(error);
    }
  }

  /**
   * إيقاف الدخول: العضوية تنتهي فوراً والرقم السري يُمسح والجلسات تُنهى، و`employees.user_id` يبقى لإعادة
   * الإعطاء لاحقاً. الرد من نتيجة المعاملة الملتزمة (STOPPED) بلا قراءة تالية.
   */
  @Delete('staff-access')
  @Authenticated()
  @UseGuards(SelectedCompanyGuard)
  @HttpCode(200)
  async stop(
    @Param('businessId', new ZodValidationPipe(id)) businessId: string,
    @Param('employeeId', new ZodValidationPipe(id)) employeeId: string,
    @Req() request: FastifyRequest,
  ): Promise<unknown> {
    const actor = actorOf(request);
    this.ready();
    try {
      const stopped = await (this.stopUseCase as StopEmployeeStaffAccessUseCase).execute({
        ...actor,
        businessId,
        employeeId,
      });
      return staffAccessState.parse({
        state: 'STOPPED',
        role: stopped.role,
        branch_id: stopped.branchId,
        phone_last3: null,
        can_manage: true,
        can_cancel: false,
      });
    } catch (error) {
      throw staffAccessApiError(error);
    }
  }

  /** حالة الدخول للوحة: الدور والفرع وآخر ثلاثة أرقام وصلاحية الإعطاء. */
  @Get('staff-access')
  @Authenticated()
  @UseGuards(SelectedCompanyGuard)
  async state(
    @Param('businessId', new ZodValidationPipe(id)) businessId: string,
    @Param('employeeId', new ZodValidationPipe(id)) employeeId: string,
    @Req() request: FastifyRequest,
  ): Promise<unknown> {
    const actor = actorOf(request);
    this.ready();
    return this.readStateOrNotFound(actor.companyId, actor.userId, businessId, employeeId);
  }

  /** إلغاء سجل انتظار متجاوز: الحالة بعد الإلغاء ترجع NONE. */
  @Delete('staff-access/pending')
  @Authenticated()
  @UseGuards(SelectedCompanyGuard)
  @HttpCode(200)
  async cancelPending(
    @Param('businessId', new ZodValidationPipe(id)) businessId: string,
    @Param('employeeId', new ZodValidationPipe(id)) employeeId: string,
    @Req() request: FastifyRequest,
  ): Promise<unknown> {
    const actor = actorOf(request);
    this.ready();
    let outcome: CancelPendingStaffAccessOutcome;
    try {
      outcome = await (this.cancelUseCase as CancelPendingStaffAccessUseCase).execute({
        ...actor,
        businessId,
        employeeId,
      });
    } catch (error) {
      throw staffAccessApiError(error);
    }
    try {
      return await this.readStateOrNotFound(
        actor.companyId,
        actor.userId,
        businessId,
        employeeId,
        readGrantedEmployeeStaffAccess,
      );
    } catch {
      // الإلغاء تزم: قراءة الحالة هي اللي بتجيب الرد، وفشلها ما بيرجعش النتيجة الملتزمة لخطأ (AC-ACT-11).
      return this.committedCancelState(outcome);
    }
  }

  /**
   * حالة الإلغاء الملتزم بلا قراءة تانية: NONE للسجل اللي اتشال وSTOPPED لللي رجع متوقفاً.
   * آخر ثلاثة أرقام بتضيع مع القراءة الفاشلة — أحسن من رقم مخترع.
   */
  private committedCancelState(outcome: CancelPendingStaffAccessOutcome): unknown {
    return staffAccessState.parse({
      state: outcome.kind === 'cancelled' ? 'NONE' : 'STOPPED',
      role: outcome.role,
      branch_id: outcome.branchId,
      phone_last3: null,
      can_manage: true,
      can_cancel: false,
    });
  }

  /** كل مسارات القدرة مقفولة حتى تُشغَّل من المتغير عند التشغيل (plan §1.1). */
  private ready(): void {
    if (
      !this.enabled ||
      this.grantUseCase === null ||
      this.cancelUseCase === null ||
      this.resetUseCase === null ||
      this.phoneUseCase === null ||
      this.stopUseCase === null ||
      this.reads === null ||
      this.database === null
    )
      throw new ApiError('NOT_READY');
  }

  private async readStateOrNotFound(
    companyId: string,
    userId: string,
    businessId: string,
    employeeId: string,
    query = readEmployeeStaffAccess,
  ): Promise<unknown> {
    const database = this.database as TenantWrappers;
    const reads = this.reads as EmployeeAccessStateReads;
    try {
      const state = await database.withTenant(
        companyId,
        (tx) => query(tx, { companyId, businessId, employeeId, actorUserId: userId }, reads),
        { userId },
      );
      if (state === null) throw new ApiError('EMPLOYEE_NOT_FOUND');
      return state;
    } catch (error) {
      // فشل عابر في قراءة auth (انقطاع اتصال أو مجمع محدود) يُعاد كـ 409 مثل مسار الكتابة.
      throw staffAccessApiError(error);
    }
  }
}
