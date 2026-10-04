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
  id,
  passkeyHistoryQuery,
  unbindPasskeyInput,
  type PasskeyHistoryQuery,
  type UnbindPasskeyInput,
} from '@pospay/contracts';
import type { TenantWrappers } from '@pospay/db';
import type { FastifyRequest } from 'fastify';
import { Authenticated } from '../../../shared/access.decorators.ts';
import { actorOf } from '../../../shared/actor.ts';
import { DATABASE } from '../../../shared/database.token.ts';
import { ApiError } from '../../../shared/errors.ts';
import { SelectedCompanyGuard } from '../../../shared/selected-company.guard.ts';
import { ZodValidationPipe } from '../../../shared/zod-validation.pipe.ts';
import { employeePasskeys } from '../queries/employee-passkeys.query.ts';
import { passkeyEmployees } from '../queries/passkey-employees.query.ts';
import { MANAGER_PASSKEY_ACCESS, type ManagerPasskeyAccess } from '../queries/passkey-access.ts';
import {
  UnbindPasskeyError,
  UnbindPasskeyUseCase,
} from '../use-cases/unbind-passkey/unbind-passkey.usecase.ts';
import { EmployeePasskeyUnbindGuard } from './employee-passkey-unbind.guard.ts';

@Controller('businesses/:businessId')
export class EmployeePasskeysController {
  constructor(
    @Inject(DATABASE) private readonly database: TenantWrappers | null,
    @Inject(MANAGER_PASSKEY_ACCESS) private readonly access: ManagerPasskeyAccess | null,
    @Inject(UnbindPasskeyUseCase) private readonly unbindPasskey: UnbindPasskeyUseCase | null,
  ) {}
  @Get('employees/:employeeId/passkeys')
  @Authenticated()
  @UseGuards(SelectedCompanyGuard)
  async history(
    @Param('businessId', new ZodValidationPipe(id)) businessId: string,
    @Param('employeeId', new ZodValidationPipe(id)) employeeId: string,
    @Query(new ZodValidationPipe(passkeyHistoryQuery)) query: PasskeyHistoryQuery,
    @Req() request: FastifyRequest,
  ) {
    if (this.database === null || this.access === null) throw new ApiError('NOT_READY');
    const actor = actorOf(request),
      access = this.access;
    const result = await this.database.withTenant(
      actor.companyId,
      (tx) => employeePasskeys(tx, { ...actor, businessId, employeeId }, query, access),
      { userId: actor.userId },
    );
    if (result === null) throw new ApiError('NOT_FOUND');
    if (result === 'FEATURE_DISABLED') throw new ApiError('FEATURE_DISABLED');
    return result;
  }
  @Get('employee-passkeys')
  @Authenticated()
  @UseGuards(SelectedCompanyGuard)
  async list(
    @Param('businessId', new ZodValidationPipe(id)) businessId: string,
    @Query(new ZodValidationPipe(passkeyHistoryQuery)) query: PasskeyHistoryQuery,
    @Req() request: FastifyRequest,
  ) {
    if (this.database === null || this.access === null) throw new ApiError('NOT_READY');
    const actor = actorOf(request),
      access = this.access;
    const result = await this.database.withTenant(
      actor.companyId,
      (tx) => passkeyEmployees(tx, { ...actor, businessId }, query, access),
      { userId: actor.userId },
    );
    if (result === 'FEATURE_DISABLED') throw new ApiError('FEATURE_DISABLED');
    return result;
  }
  @Post('employees/:employeeId/passkeys/unbind')
  @HttpCode(200)
  @Authenticated()
  @UseGuards(SelectedCompanyGuard, EmployeePasskeyUnbindGuard)
  async unbind(
    @Param('businessId', new ZodValidationPipe(id)) businessId: string,
    @Param('employeeId', new ZodValidationPipe(id)) employeeId: string,
    @Body(new ZodValidationPipe(unbindPasskeyInput)) input: UnbindPasskeyInput,
    @Req() request: FastifyRequest,
  ) {
    if (this.unbindPasskey === null) throw new ApiError('NOT_READY');
    try {
      return await this.unbindPasskey.execute(
        { ...actorOf(request), businessId, employeeId },
        input,
      );
    } catch (error) {
      if (error instanceof UnbindPasskeyError) throw new ApiError(error.code);
      throw error;
    }
  }
}
