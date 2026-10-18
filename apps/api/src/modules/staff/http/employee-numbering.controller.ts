import { Body, Controller, Get, Inject, Put, Req } from '@nestjs/common';
import { employeeNumbering, setEmployeeNumberStartInput, type SetEmployeeNumberStartInput } from '@pospay/contracts';
import type { TenantWrappers } from '@pospay/db';
import type { FastifyRequest } from 'fastify';
import { Require, RequiresFeature } from '../../../shared/access.decorators.ts';
import { actorOf } from '../../../shared/actor.ts';
import { DATABASE } from '../../../shared/database.token.ts';
import { ApiError } from '../../../shared/errors.ts';
import { ZodValidationPipe } from '../../../shared/zod-validation.pipe.ts';
import { readEmployeeNumbering } from '../queries/employee-numbering.query.ts';
import {
  SetEmployeeNumberStartError,
  SetEmployeeNumberStartUseCase,
} from '../use-cases/set-employee-number-start/set-employee-number-start.usecase.ts';

@Controller('employee-numbering')
export class EmployeeNumberingController {
  constructor(
    @Inject(SetEmployeeNumberStartUseCase) private readonly setStart: SetEmployeeNumberStartUseCase | null,
    @Inject(DATABASE) private readonly database: TenantWrappers | null,
  ) {}

  @Get()
  @Require('manage:employee-number:company')
  @RequiresFeature('staff')
  show(@Req() request: FastifyRequest) {
    if (this.database === null) throw new ApiError('NOT_READY');
    const actor = actorOf(request);
    return this.database.withTenant(actor.companyId, (tx) => readEmployeeNumbering(tx, actor.companyId), {
      userId: actor.userId,
    });
  }

  @Put('start')
  @Require('manage:employee-number:company')
  @RequiresFeature('staff')
  async start(
    @Body(new ZodValidationPipe(setEmployeeNumberStartInput)) input: SetEmployeeNumberStartInput,
    @Req() request: FastifyRequest,
  ) {
    if (this.setStart === null) throw new ApiError('NOT_READY');
    try {
      return employeeNumbering.parse(
        await this.setStart.execute({ ...actorOf(request), startNumber: input.start_number }),
      );
    } catch (error) {
      if (error instanceof SetEmployeeNumberStartError) throw new ApiError(error.code);
      throw error;
    }
  }
}
