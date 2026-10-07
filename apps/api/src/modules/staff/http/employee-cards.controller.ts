import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  id,
  issueEmployeeCardInput,
  type EmployeeCard,
  type EmployeeCardsView,
  type IssueEmployeeCardInput,
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
import { readEmployeeCards } from '../queries/employee-cards.query.ts';
import {
  EmployeeCardError,
  EMPLOYEE_CARD_ACCESS,
  type EmployeeCardAccess,
  IssueEmployeeCard,
  type EmployeeCardRecord,
} from '../use-cases/issue-employee-card/issue-employee-card.usecase.ts';
import { RevokeEmployeeCard } from '../use-cases/revoke-employee-card/revoke-employee-card.usecase.ts';

@Controller('businesses/:businessId/employees/:employeeId/cards')
export class EmployeeCardsController {
  constructor(
    @Inject(IssueEmployeeCard) private readonly issue: IssueEmployeeCard | null,
    @Inject(RevokeEmployeeCard) private readonly revoke: RevokeEmployeeCard | null,
    @Inject(DATABASE) private readonly database: TenantWrappers | null,
    @Inject(EMPLOYEE_CARD_ACCESS) private readonly access: EmployeeCardAccess | null,
  ) {}
  @Get()
  @Authenticated()
  @UseGuards(SelectedCompanyGuard)
  async view(
    @Param('businessId', new ZodValidationPipe(id)) businessId: string,
    @Param('employeeId', new ZodValidationPipe(id)) employeeId: string,
    @Req() request: FastifyRequest,
  ): Promise<EmployeeCardsView> {
    if (this.database === null || this.access === null) throw new ApiError('NOT_READY');
    const actor = actorOf(request);
    const access = this.access;
    const view = await this.database.withTenant(
      actor.companyId,
      (tx) =>
        readEmployeeCards(tx, actor.companyId, actor.userId, businessId, employeeId, access),
      { userId: actor.userId },
    );
    if (view === null) throw new ApiError('NOT_FOUND');
    if (view === 'FEATURE_DISABLED') throw new ApiError('FEATURE_DISABLED');
    return view;
  }
  @Post()
  @HttpCode(200)
  @Authenticated()
  @UseGuards(SelectedCompanyGuard)
  async issueCard(
    @Param('businessId', new ZodValidationPipe(id)) businessId: string,
    @Param('employeeId', new ZodValidationPipe(id)) employeeId: string,
    @Body(new ZodValidationPipe(issueEmployeeCardInput)) input: IssueEmployeeCardInput,
    @Req() request: FastifyRequest,
    @Idempotency() idem: IdempotencyInput,
  ): Promise<EmployeeCard> {
    if (this.issue === null) throw new ApiError('NOT_READY');
    const actor = actorOf(request);
    try {
      return cardView(
        await this.issue.execute(
          { companyId: actor.companyId, businessId, employeeId, operatorId: actor.userId },
          input.card_code,
          idem,
        ),
      );
    } catch (error) {
      throw cardFailure(error);
    }
  }
  @Post(':cardId/revoke')
  @HttpCode(200)
  @Authenticated()
  @UseGuards(SelectedCompanyGuard)
  async revokeCard(
    @Param('businessId', new ZodValidationPipe(id)) businessId: string,
    @Param('employeeId', new ZodValidationPipe(id)) employeeId: string,
    @Param('cardId', new ZodValidationPipe(id)) cardId: string,
    @Req() request: FastifyRequest,
    @Idempotency() idem: IdempotencyInput,
  ): Promise<EmployeeCard> {
    if (this.revoke === null) throw new ApiError('NOT_READY');
    const actor = actorOf(request);
    try {
      return cardView(
        await this.revoke.execute(
          { companyId: actor.companyId, businessId, employeeId, operatorId: actor.userId },
          cardId,
          idem,
        ),
      );
    } catch (error) {
      throw cardFailure(error);
    }
  }
}

function cardView(record: EmployeeCardRecord): EmployeeCard {
  return {
    id: record.id,
    employee_id: record.employeeId,
    card_code_suffix: record.cardCodeSuffix,
    issued_at: record.issuedAt,
    revoked_at: record.revokedAt,
  };
}
function cardFailure(error: unknown): unknown {
  if (error instanceof EmployeeCardError) return new ApiError(error.code);
  return error;
}
