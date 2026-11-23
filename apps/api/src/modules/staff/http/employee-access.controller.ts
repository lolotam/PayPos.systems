import { Body, Controller, Delete, Get, HttpCode, Inject, Param, Post, Req, UseGuards } from '@nestjs/common';
import { grantStaffAccessInput, type GrantStaffAccessInput, id } from '@pospay/contracts';
import type { TenantWrappers } from '@pospay/db';
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
  type EmployeeAccessStateReads,
} from '../queries/employee-staff-access.query.ts';
import { StaffAccessError, GrantEmployeeAccessUseCase } from '../use-cases/grant-employee-access/grant-employee-access.ts';
import { CancelPendingStaffAccessUseCase } from '../use-cases/cancel-pending-staff-access/cancel-pending-staff-access.ts';

/** بوابة التفعيل (FR-F1-9): تُقرأ مرة واحدة عند التشغيل من STAFF_ACCESS_ROUTES، وكل المسارات ترد 503 بدونها. */
export const STAFF_ACCESS_ROUTES_ENABLED = Symbol('STAFF_ACCESS_ROUTES_ENABLED');

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
      await (this.grantUseCase as GrantEmployeeAccessUseCase).execute({
        ...actor,
        businessId,
        employeeId,
        role: input.role,
        phone: input.phone,
        pin: input.pin,
      });
    } catch (error) {
      if (error instanceof StaffAccessError) throw new ApiError(error.code);
      throw error;
    }
    return this.readStateOrNotFound(actor.companyId, actor.userId, businessId, employeeId);
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
    try {
      await (this.cancelUseCase as CancelPendingStaffAccessUseCase).execute({
        ...actor,
        businessId,
        employeeId,
      });
    } catch (error) {
      if (error instanceof StaffAccessError) throw new ApiError(error.code);
      throw error;
    }
    return this.readStateOrNotFound(actor.companyId, actor.userId, businessId, employeeId);
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
  ): Promise<unknown> {
    const database = this.database as TenantWrappers;
    const reads = this.reads as EmployeeAccessStateReads;
    const state = await database.withTenant(
      companyId,
      (tx) =>
        readEmployeeStaffAccess(
          tx,
          { companyId, businessId, employeeId, actorUserId: userId },
          reads,
        ),
      { userId },
    );
    if (state === null) throw new ApiError('EMPLOYEE_NOT_FOUND');
    return state;
  }
}
