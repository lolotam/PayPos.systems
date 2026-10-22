import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Param,
  Put,
  Query,
  Req,
} from '@nestjs/common';
import {
  alertKind,
  id,
  resetBranchAlertRuleQuery,
  setAlertRulesInput,
  setAlertsMasterInput,
  type AlertRules,
  type ResetBranchAlertRuleQuery,
  type SetAlertRulesInput,
  type SetAlertsMasterInput,
} from '@pospay/contracts';
import type { TenantWrappers, Tx } from '@pospay/db';
import type { FastifyRequest } from 'fastify';

import { Require } from '../../../shared/access.decorators.ts';
import { actorOf } from '../../../shared/actor.ts';
import { DATABASE } from '../../../shared/database.token.ts';
import { ApiError } from '../../../shared/errors.ts';
import { ZodValidationPipe } from '../../../shared/zod-validation.pipe.ts';
import { alertRulesQuery } from '../queries/alert-rules.query.ts';
import { alertRulesView } from '../use-cases/alert-rules-view/alert-rules-view.ts';
import type { ResetBranchAlertRule } from '../use-cases/reset-branch-alert-rule/reset-branch-alert-rule.ts';
import type { SetAlertRules } from '../use-cases/set-alert-rules/set-alert-rules.ts';
import type { SetAlertsMaster } from '../use-cases/set-alerts-master/set-alerts-master.ts';

export interface AlertRulesWiring {
  /** قرار قراية قواعد فرع على معاملة القراية نفسها (نفس قرار الكتابة: النشاط كله والفرع). */
  readonly branchAccess: {
    read(
      tx: Tx,
      companyId: string,
      userId: string,
      target: { businessId: string; branchId: string },
    ): Promise<'FORBIDDEN' | null>;
  };
  readonly set: SetAlertRules;
  readonly reset: ResetBranchAlertRule;
  readonly master: SetAlertsMaster;
}
export const ALERT_RULES_WIRING = Symbol('ALERT_RULES_WIRING');


@Controller()
export class AlertRulesController {
  readonly #wiring: AlertRulesWiring | null;
  readonly #db: TenantWrappers | null;

  constructor(
    @Inject(ALERT_RULES_WIRING) wiring: AlertRulesWiring | null,
    @Inject(DATABASE) db: TenantWrappers | null,
  ) {
    this.#wiring = wiring;
    this.#db = db;
  }

  @Get('businesses/:businessId/alert-rules')
  @Require('manage:alert-rules:business', { business: 'businessId' })
  readBusiness(
    @Param('businessId', new ZodValidationPipe(id)) businessId: string,
    @Req() request: FastifyRequest,
  ): Promise<AlertRules> {
    return this.#read(request, businessId, null);
  }

  @Put('businesses/:businessId/alert-rules')
  @Require('manage:alert-rules:business', { business: 'businessId' })
  async setBusiness(
    @Param('businessId', new ZodValidationPipe(id)) businessId: string,
    @Body(new ZodValidationPipe(setAlertRulesInput)) input: SetAlertRulesInput,
    @Req() request: FastifyRequest,
  ): Promise<AlertRules> {
    return this.#set(request, businessId, null, input);
  }

  @Put('businesses/:businessId/alert-rules/master')
  @Require('manage:alert-rules:business', { business: 'businessId' })
  async setMaster(
    @Param('businessId', new ZodValidationPipe(id)) businessId: string,
    @Body(new ZodValidationPipe(setAlertsMasterInput)) input: SetAlertsMasterInput,
    @Req() request: FastifyRequest,
  ): Promise<AlertRules> {
    if (this.#wiring === null) throw new ApiError('NOT_READY');
    const business = businessId.toLowerCase();
    return this.#wiring.master.execute(actorOf(request), business, input.alerts_enabled);
  }

  @Get('businesses/:businessId/branches/:branchId/alert-rules')
  @Require('manage:alert-rules:business', { business: 'businessId' })
  readBranch(
    @Param('businessId', new ZodValidationPipe(id)) businessId: string,
    @Param('branchId', new ZodValidationPipe(id)) branchId: string,
    @Req() request: FastifyRequest,
  ): Promise<AlertRules> {
    return this.#read(request, businessId, branchId);
  }

  @Put('businesses/:businessId/branches/:branchId/alert-rules')
  @Require('manage:alert-rules:business', { business: 'businessId' })
  async setBranch(
    @Param('businessId', new ZodValidationPipe(id)) businessId: string,
    @Param('branchId', new ZodValidationPipe(id)) branchId: string,
    @Body(new ZodValidationPipe(setAlertRulesInput)) input: SetAlertRulesInput,
    @Req() request: FastifyRequest,
  ): Promise<AlertRules> {
    return this.#set(request, businessId, branchId, input);
  }

  @Delete('businesses/:businessId/branches/:branchId/alert-rules/:kind')
  @HttpCode(204)
  @Require('manage:alert-rules:business', { business: 'businessId' })
  async resetBranch(
    @Param('businessId', new ZodValidationPipe(id)) businessId: string,
    @Param('branchId', new ZodValidationPipe(id)) branchId: string,
    @Param('kind', new ZodValidationPipe(alertKind)) kind: SetAlertRulesInput['rules'][number]['kind'],
    @Query(new ZodValidationPipe(resetBranchAlertRuleQuery)) expected: ResetBranchAlertRuleQuery,
    @Req() request: FastifyRequest,
  ): Promise<void> {
    if (this.#wiring === null) throw new ApiError('NOT_READY');
    const target = { businessId: businessId.toLowerCase(), branchId: branchId.toLowerCase() };
    await this.#wiring.reset.execute(actorOf(request), target, kind, expected);
  }

  async #set(
    request: FastifyRequest,
    businessId: string,
    branchId: string | null,
    input: SetAlertRulesInput,
  ): Promise<AlertRules> {
    if (this.#wiring === null) throw new ApiError('NOT_READY');
    const target = { businessId: businessId.toLowerCase(), branchId: branchId?.toLowerCase() ?? null };
    return this.#wiring.set.execute(actorOf(request), target, input);
  }

  async #read(
    request: FastifyRequest,
    businessId: string,
    branchId: string | null,
  ): Promise<AlertRules> {
    if (this.#db === null || this.#wiring === null) throw new ApiError('NOT_READY');
    const actor = actorOf(request);
    const business = businessId.toLowerCase();
    const branch = branchId?.toLowerCase() ?? null;
    const access = this.#wiring.branchAccess;
    const stored = await this.#db.withTenant(
      actor.companyId,
      async (tx) => {
        if (branch !== null) {
          const target = { businessId: business, branchId: branch };
          if ((await access.read(tx, actor.companyId, actor.userId, target)) !== null) return null;
        }
        return alertRulesQuery(tx, actor.companyId, business, branch);
      },
      { userId: actor.userId },
    );
    if (stored === null) throw new ApiError('FORBIDDEN');
    return alertRulesView({ businessId: business, branchId: branch }, stored);
  }
}
