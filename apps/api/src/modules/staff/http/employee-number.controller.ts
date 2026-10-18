import { Body, Controller, Inject, Param, Put, Req } from '@nestjs/common';
import { employeeNumberView, id, setEmployeeNumberInput, type SetEmployeeNumberInput } from '@pospay/contracts';
import type { FastifyRequest } from 'fastify';
import { Require } from '../../../shared/access.decorators.ts';
import { actorOf } from '../../../shared/actor.ts';
import { ApiError } from '../../../shared/errors.ts';
import { ZodValidationPipe } from '../../../shared/zod-validation.pipe.ts';
import { SetEmployeeNumberError, SetEmployeeNumberUseCase } from '../use-cases/set-employee-number/set-employee-number.usecase.ts';

@Controller('businesses/:businessId/employees/:employeeId')
export class EmployeeNumberController {
  constructor(@Inject(SetEmployeeNumberUseCase) private readonly setNumber: SetEmployeeNumberUseCase | null) {}

  @Put('employee-number')
  @Require('manage:employee-number:company')
  async set(
    @Param('businessId', new ZodValidationPipe(id)) businessId: string,
    @Param('employeeId', new ZodValidationPipe(id)) employeeId: string,
    @Body(new ZodValidationPipe(setEmployeeNumberInput)) input: SetEmployeeNumberInput,
    @Req() request: FastifyRequest,
  ) {
    if (!this.setNumber) throw new ApiError('NOT_READY');
    try {
      return employeeNumberView.parse(await this.setNumber.execute({
        ...actorOf(request),
        businessId,
        employeeId,
        employeeNumber: input.employee_number,
      }));
    } catch (error) {
      if (error instanceof SetEmployeeNumberError) throw new ApiError(error.code);
      throw error;
    }
  }
}
