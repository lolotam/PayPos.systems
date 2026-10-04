import { Body, Controller, HttpCode, Inject, Param, Post, Req, UseGuards } from '@nestjs/common';
import {
  decideLeaveInput,
  revokeLeaveInput,
  id,
  type DecideLeaveInput,
  type RevokeLeaveInput,
} from '@pospay/contracts';
import type { FastifyRequest } from 'fastify';
import { Authenticated } from '../../../shared/access.decorators.ts';
import { actorOf } from '../../../shared/actor.ts';
import { ApiError } from '../../../shared/errors.ts';
import { Idempotency, type IdempotencyInput } from '../../../shared/idempotency.ts';
import { SelectedCompanyGuard } from '../../../shared/selected-company.guard.ts';
import { ZodValidationPipe } from '../../../shared/zod-validation.pipe.ts';
import { DecideLeaveUseCase } from '../use-cases/decide-leave/decide-leave.usecase.ts';
import { RevokeLeaveUseCase } from '../use-cases/revoke-leave/revoke-leave.usecase.ts';
import { leaveHttpResult } from './leave-http.ts';

@Controller('businesses/:businessId/employees/:employeeId/leave-requests')
@UseGuards(SelectedCompanyGuard)
export class LeaveDecisionsController {
  constructor(
    @Inject(DecideLeaveUseCase) private readonly decide: DecideLeaveUseCase | null,
    @Inject(RevokeLeaveUseCase) private readonly revoke: RevokeLeaveUseCase | null,
  ) {}
  @Post(':leaveId/decide')
  @HttpCode(200)
  @Authenticated()
  decideRequest(
    @Param('businessId', new ZodValidationPipe(id)) businessId: string,
    @Param('employeeId', new ZodValidationPipe(id)) employeeId: string,
    @Param('leaveId', new ZodValidationPipe(id)) leaveId: string,
    @Body(new ZodValidationPipe(decideLeaveInput)) input: DecideLeaveInput,
    @Idempotency() idem: IdempotencyInput,
    @Req() req: FastifyRequest,
  ) {
    if (!this.decide) throw new ApiError('NOT_READY');
    return leaveHttpResult(
      this.decide.execute(
        { ...actorOf(req), ...idem, businessId, employeeId, leaveId, own: false },
        input,
      ),
    );
  }
  @Post(':leaveId/revoke')
  @HttpCode(200)
  @Authenticated()
  revokeRequest(
    @Param('businessId', new ZodValidationPipe(id)) businessId: string,
    @Param('employeeId', new ZodValidationPipe(id)) employeeId: string,
    @Param('leaveId', new ZodValidationPipe(id)) leaveId: string,
    @Body(new ZodValidationPipe(revokeLeaveInput)) input: RevokeLeaveInput,
    @Idempotency() idem: IdempotencyInput,
    @Req() req: FastifyRequest,
  ) {
    if (!this.revoke) throw new ApiError('NOT_READY');
    return leaveHttpResult(
      this.revoke.execute(
        { ...actorOf(req), ...idem, businessId, employeeId, leaveId, own: false },
        input,
      ),
    );
  }
}
