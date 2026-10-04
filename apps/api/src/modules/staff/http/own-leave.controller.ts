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
  SetMetadata,
  UseGuards,
} from '@nestjs/common';
import {
  cancelLeaveInput,
  id,
  ownLeaveBranchQuery,
  ownLeaveListQuery,
  requestLeaveInput,
  type CancelLeaveInput,
  type OwnLeaveBranchQuery,
  type OwnLeaveListQuery,
  type RequestLeaveInput,
} from '@pospay/contracts';
import type { TenantWrappers } from '@pospay/db';
import type { FastifyRequest } from 'fastify';
import { Authenticated } from '../../../shared/access.decorators.ts';
import { DATABASE } from '../../../shared/database.token.ts';
import { ApiError } from '../../../shared/errors.ts';
import { Idempotency, type IdempotencyInput } from '../../../shared/idempotency.ts';
import { STAFF_ROUTE } from '../../../shared/staff-authentication.ts';
import { PERSONAL_ROUTE } from '../../../shared/personal-authentication.ts';
import { ZodValidationPipe } from '../../../shared/zod-validation.pipe.ts';
import { LeaveValidationPipe } from './leave-validation.pipe.ts';
import {
  LEAVE_READ_ACCESS,
  employeeLeaveHistory,
  type LeaveReadAccess,
} from '../queries/leave-requests.query.ts';
import { RequestLeaveUseCase } from '../use-cases/request-leave/request-leave.usecase.ts';
import { CancelLeaveUseCase } from '../use-cases/cancel-leave/cancel-leave.usecase.ts';
import { leaveHttpResult, ownLeaveActor } from './leave-http.ts';
import { StaffLeaveGuard } from './staff-leave.guard.ts';
@Controller('staff/me/leave-requests')
@UseGuards(StaffLeaveGuard)
export class OwnLeaveController {
  constructor(
    @Inject(RequestLeaveUseCase) private readonly create: RequestLeaveUseCase | null,
    @Inject(CancelLeaveUseCase) private readonly cancel: CancelLeaveUseCase | null,
    @Inject(DATABASE) private readonly database: TenantWrappers | null,
    @Inject(LEAVE_READ_ACCESS) private readonly access: LeaveReadAccess,
  ) {}
  @Post()
  @HttpCode(201)
  @Authenticated()
  @SetMetadata(STAFF_ROUTE, 'staff')
  @SetMetadata(PERSONAL_ROUTE, 'staff')
  request(
    @Query(new ZodValidationPipe(ownLeaveBranchQuery)) query: OwnLeaveBranchQuery,
    @Body(new LeaveValidationPipe(requestLeaveInput)) input: RequestLeaveInput,
    @Idempotency() idem: IdempotencyInput,
    @Req() req: FastifyRequest,
  ) {
    if (!this.create) throw new ApiError('NOT_READY');
    return leaveHttpResult(this.create.execute(ownLeaveActor(req, idem, query.branch_id), input));
  }
  @Post(':leaveId/cancel')
  @HttpCode(200)
  @Authenticated()
  @SetMetadata(STAFF_ROUTE, 'staff')
  @SetMetadata(PERSONAL_ROUTE, 'staff')
  cancelRequest(
    @Query(new ZodValidationPipe(ownLeaveBranchQuery)) query: OwnLeaveBranchQuery,
    @Param('leaveId', new ZodValidationPipe(id)) leaveId: string,
    @Body(new ZodValidationPipe(cancelLeaveInput)) input: CancelLeaveInput,
    @Idempotency() idem: IdempotencyInput,
    @Req() req: FastifyRequest,
  ) {
    if (!this.cancel) throw new ApiError('NOT_READY');
    return leaveHttpResult(
      this.cancel.execute({ ...ownLeaveActor(req, idem, query.branch_id), leaveId }, input),
    );
  }
  @Get()
  @Authenticated()
  @SetMetadata(STAFF_ROUTE, 'staff')
  @SetMetadata(PERSONAL_ROUTE, 'staff')
  async list(
    @Query(new ZodValidationPipe(ownLeaveListQuery)) query: OwnLeaveListQuery,
    @Req() req: FastifyRequest,
  ) {
    if (!this.database) throw new ApiError('NOT_READY');
    const context = ownLeaveActor(req, undefined, query.branch_id);
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
