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
  attendanceChangeListQuery,
  attendanceChangeRequestInput,
  cancelAttendanceChangeInput,
  decideAttendanceChangeInput,
  id,
  type AttendanceChangeListQuery,
  type AttendanceChangeRequestInput,
  type CancelAttendanceChangeInput,
  type DecideAttendanceChangeInput,
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
import { RequestAttendanceChangeUseCase } from '../use-cases/request-attendance-change/request-attendance-change.usecase.ts';
import { CancelAttendanceChangeUseCase } from '../use-cases/cancel-attendance-change/cancel-attendance-change.usecase.ts';
import { DecideAttendanceChangeUseCase } from '../use-cases/decide-attendance-change/decide-attendance-change.usecase.ts';
import {
  ATTENDANCE_CHANGE_READ_ACCESS,
  listAttendanceChangeRequests,
  type AttendanceChangeReadAccess,
} from '../queries/attendance-change-requests.query.ts';
import { attendanceChangeHttpResult } from './attendance-change-http.ts';

@Controller('businesses/:businessId/attendance-change-requests')
@UseGuards(SelectedCompanyGuard)
export class AttendanceChangeRequestsController {
  constructor(
    @Inject(RequestAttendanceChangeUseCase)
    private readonly request: RequestAttendanceChangeUseCase | null,
    @Inject(CancelAttendanceChangeUseCase)
    private readonly cancel: CancelAttendanceChangeUseCase | null,
    @Inject(DecideAttendanceChangeUseCase)
    private readonly decide: DecideAttendanceChangeUseCase | null,
    @Inject(DATABASE) private readonly database: TenantWrappers | null,
    @Inject(ATTENDANCE_CHANGE_READ_ACCESS) private readonly access: AttendanceChangeReadAccess,
  ) {}
  @Post()
  @HttpCode(201)
  @Authenticated()
  file(
    @Param('businessId', new ZodValidationPipe(id)) businessId: string,
    @Body(new ZodValidationPipe(attendanceChangeRequestInput)) input: AttendanceChangeRequestInput,
    @Idempotency() idem: IdempotencyInput,
    @Req() req: FastifyRequest,
  ) {
    if (!this.request) throw new ApiError('NOT_READY');
    return attendanceChangeHttpResult(
      this.request.execute({ ...actorOf(req), ...idem, businessId }, input),
    );
  }
  @Post(':requestId/cancel')
  @HttpCode(200)
  @Authenticated()
  withdraw(
    @Param('businessId', new ZodValidationPipe(id)) businessId: string,
    @Param('requestId', new ZodValidationPipe(id)) requestId: string,
    @Body(new ZodValidationPipe(cancelAttendanceChangeInput)) input: CancelAttendanceChangeInput,
    @Idempotency() idem: IdempotencyInput,
    @Req() req: FastifyRequest,
  ) {
    if (!this.cancel) throw new ApiError('NOT_READY');
    return attendanceChangeHttpResult(
      this.cancel.execute({ ...actorOf(req), ...idem, businessId, requestId }, input),
    );
  }
  @Post(':requestId/decide')
  @HttpCode(200)
  @Authenticated()
  decision(
    @Param('businessId', new ZodValidationPipe(id)) businessId: string,
    @Param('requestId', new ZodValidationPipe(id)) requestId: string,
    @Body(new ZodValidationPipe(decideAttendanceChangeInput)) input: DecideAttendanceChangeInput,
    @Idempotency() idem: IdempotencyInput,
    @Req() req: FastifyRequest,
  ) {
    if (!this.decide) throw new ApiError('NOT_READY');
    return attendanceChangeHttpResult(
      this.decide.execute({ ...actorOf(req), ...idem, businessId, requestId }, input),
    );
  }
  @Get()
  @Authenticated()
  async list(
    @Param('businessId', new ZodValidationPipe(id)) businessId: string,
    @Query(new ZodValidationPipe(attendanceChangeListQuery)) query: AttendanceChangeListQuery,
    @Req() req: FastifyRequest,
  ) {
    if (!this.database) throw new ApiError('NOT_READY');
    const context = { ...actorOf(req), businessId };
    const result = await this.database.withTenant(
      context.companyId,
      (tx) => listAttendanceChangeRequests(tx, context, query, this.access),
      { userId: context.userId },
    );
    if (result === null) throw new ApiError('NOT_FOUND');
    if (result === 'VALIDATION_FAILED') throw new ApiError(result);
    return result;
  }
}
