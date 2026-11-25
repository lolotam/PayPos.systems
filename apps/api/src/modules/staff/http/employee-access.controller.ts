import { Body, Controller, Delete, Get, HttpCode, Inject, Param, Post, Req, UseGuards } from '@nestjs/common';
import {
  grantStaffAccessInput,
  staffAccessState,
  type GrantStaffAccessInput,
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
import { StaffAccessError, GrantEmployeeAccessUseCase } from '../use-cases/grant-employee-access/grant-employee-access.ts';
import {
  CancelPendingStaffAccessUseCase,
  type CancelPendingStaffAccessOutcome,
} from '../use-cases/cancel-pending-staff-access/cancel-pending-staff-access.ts';

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
      });
      // الرد من نتيجة المعاملة الملتزمة نفسها: لا قراءة تالية (معاملة جديدة ومكالمة auth) قد تفشل
      // فتحوّل منحاً ملتزماً إلى 500. الحالة بعد المنح ACTIVE دائماً ولا إدارة متاحة عليها.
      return staffAccessState.parse({
        state: 'ACTIVE',
        role: granted.role,
        branch_id: granted.branchId,
        phone_last3: granted.phoneLast3,
        can_manage: false,
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
    });
  }

  /** كل مسارات القدرة مقفولة حتى تُشغَّل من المتغير عند التشغيل (plan §1.1). */
  private ready(): void {
    if (
      !this.enabled ||
      this.grantUseCase === null ||
      this.cancelUseCase === null ||
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
        (tx) =>
          query(
            tx,
            { companyId, businessId, employeeId, actorUserId: userId },
            reads,
          ),
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
