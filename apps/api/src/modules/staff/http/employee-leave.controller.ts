import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  cancelLeaveInput,
  id,
  leaveListQuery,
  requestEmployeeLeaveInput,
  type CancelLeaveInput,
  type LeaveListQuery,
  type RequestEmployeeLeaveInput,
} from '@pospay/contracts';
import type { TenantWrappers } from '@pospay/db';
import type { FastifyRequest } from 'fastify';
import { Authenticated } from '../../../shared/access.decorators.ts';
import { actorOf } from '../../../shared/actor.ts';
import { DATABASE } from '../../../shared/database.token.ts';
import { ApiError } from '../../../shared/errors.ts';
import { Idempotency, type IdempotencyInput } from '../../../shared/idempotency.ts';
import { SelectedCompanyGuard } from '../../../shared/selected-company.guard.ts';
import { ZodValidationPipe } from '../../../shared/zod-validation.pipe.ts';
import { LeaveValidationPipe } from './leave-validation.pipe.ts';
import {
  LEAVE_READ_ACCESS,
  employeeLeaveHistory,
  type LeaveReadAccess,
} from '../queries/leave-requests.query.ts';
import { RequestLeaveUseCase } from '../use-cases/request-leave/request-leave.usecase.ts';
import { CancelLeaveUseCase } from '../use-cases/cancel-leave/cancel-leave.usecase.ts';
import { leaveHttpResult } from './leave-http.ts';
@Controller('businesses/:businessId/employees/:employeeId/leave-requests')
export class EmployeeLeaveController {
  constructor(
    @Inject(RequestLeaveUseCase) private readonly create: RequestLeaveUseCase | null,
    @Inject(CancelLeaveUseCase) private readonly cancel: CancelLeaveUseCase | null,
    @Inject(DATABASE) private readonly database: TenantWrappers | null,
    @Inject(LEAVE_READ_ACCESS) private readonly access: LeaveReadAccess,
  ) {}
  @Post()
  @HttpCode(201)
  @Authenticated()
  @UseGuards(SelectedCompanyGuard)
  request(
    @Param('businessId', new ZodValidationPipe(id)) businessId: string,
    @Param('employeeId', new ZodValidationPipe(id)) employeeId: string,
    @Body(new LeaveValidationPipe(requestEmployeeLeaveInput)) input: RequestEmployeeLeaveInput,
    @Idempotency() idem: IdempotencyInput,
    @Req() req: FastifyRequest,
  ) {
    if (!this.create) throw new ApiError('NOT_READY');
    const { branch_id: branchId, ...terms } = input;
    return leaveHttpResult(
      this.create.execute(
        { ...actorOf(req), ...idem, businessId, employeeId, branchId, own: false },
        terms,
      ),
    );
  }
  @Post(':leaveId/cancel')
  @HttpCode(200)
  @Authenticated()
  @UseGuards(SelectedCompanyGuard)
  cancelRequest(
    @Param('businessId', new ZodValidationPipe(id)) businessId: string,
    @Param('employeeId', new ZodValidationPipe(id)) employeeId: string,
    @Param('leaveId', new ZodValidationPipe(id)) leaveId: string,
    @Body(new ZodValidationPipe(cancelLeaveInput)) input: CancelLeaveInput,
    @Idempotency() idem: IdempotencyInput,
    @Req() req: FastifyRequest,
  ) {
    if (!this.cancel) throw new ApiError('NOT_READY');
    return leaveHttpResult(
      this.cancel.execute(
        { ...actorOf(req), ...idem, businessId, employeeId, leaveId, own: false },
        input,
      ),
    );
  }
  @Get()
  @Authenticated()
  @UseGuards(SelectedCompanyGuard)
  async list(
    @Param('businessId', new ZodValidationPipe(id)) businessId: string,
    @Param('employeeId', new ZodValidationPipe(id)) employeeId: string,
    @Query(new ZodValidationPipe(leaveListQuery)) query: LeaveListQuery,
    @Req() req: FastifyRequest,
  ) {
    if (!this.database) throw new ApiError('NOT_READY');
    const context = { ...actorOf(req), businessId, employeeId, own: false };
    const result = await this.database.withTenant(
      context.companyId,
      (tx) => employeeLeaveHistory(tx, context, query, this.access),
      { userId: context.userId },
    );
    if (result === null) throw new ApiError('NOT_FOUND');
    if (typeof result === 'string') throw new ApiError(result);
    return result;
  }
}
