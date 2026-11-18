import { Controller, Get, Inject, Param, Query, Req, UseGuards } from '@nestjs/common';
import {
  id,
  packageSaleContext,
  sessionPerformerOptionsQuery,
  type SessionPerformerOptionsQuery,
} from '@pospay/contracts';
import type { FastifyRequest } from 'fastify';
import { Require, RequiresFeature } from '../../../shared/access.decorators.ts';
import { actorOf } from '../../../shared/actor.ts';
import { ApiError } from '../../../shared/errors.ts';
import { REQUEST_AUTHORIZER, type RequestAuthorizer } from '../../../shared/request-authorizer.ts';
import { ZodValidationPipe } from '../../../shared/zod-validation.pipe.ts';
import { PackageSaleContextQueryHandler } from '../queries/package-sale-context.query.ts';
import { RecordingContextReadError } from '../queries/recording-context.query.ts';
import { SessionAdminGuard } from './session-access.guard.ts';

@Controller('businesses/:businessId/branches/:branchId/package-sales')
export class PackageSaleContextController {
  constructor(
    @Inject(PackageSaleContextQueryHandler)
    private readonly query: PackageSaleContextQueryHandler | null,
    @Inject(REQUEST_AUTHORIZER) private readonly authorizer: RequestAuthorizer | null,
  ) {}

  @Get('context')
  @Require('sell:packages:branch', { branch: 'branchId' })
  @RequiresFeature('orders')
  @UseGuards(SessionAdminGuard)
  async context(
    @Param('businessId', new ZodValidationPipe(id.toLowerCase())) businessId: string,
    @Param('branchId', new ZodValidationPipe(id.toLowerCase())) branchId: string,
    @Req() request: FastifyRequest,
  ) {
    const scope = { ...actorOf(request), businessId, branchId };
    const context = await this.run((query) => query.context(scope));
    return packageSaleContext.parse({
      ...context,
      customer_entry_scope: await this.customerEntryScope(scope),
    });
  }

  private async customerEntryScope(
    scope: ReturnType<typeof actorOf> & { businessId: string; branchId: string },
  ) {
    if (this.authorizer === null) throw new ApiError('NOT_READY');
    const targets = [
      ['branch', { branchParam: scope.branchId }],
      ['business', { businessParam: scope.businessId }],
      ['company', {}],
    ] as const;
    for (const [kind, target] of targets) {
      const result = await this.authorizer.execute({
        ...target,
        requestedCompany: scope.companyId,
        userId: scope.userId,
        permission: 'create:customers:' + kind,
        featureFlag: 'customers',
      });
      if (result?.feature?.enabled) return kind;
    }
    return null;
  }

  @Get('seller-options')
  @Require('sell:packages:branch', { branch: 'branchId' })
  @RequiresFeature('orders')
  @UseGuards(SessionAdminGuard)
  sellers(
    @Param('businessId', new ZodValidationPipe(id.toLowerCase())) businessId: string,
    @Param('branchId', new ZodValidationPipe(id.toLowerCase())) branchId: string,
    @Query(new ZodValidationPipe(sessionPerformerOptionsQuery)) query: SessionPerformerOptionsQuery,
    @Req() request: FastifyRequest,
  ) {
    const scope = { ...actorOf(request), businessId, branchId };
    return this.run((handler) => handler.sellers(scope, query));
  }

  private async run<T>(work: (query: PackageSaleContextQueryHandler) => Promise<T>): Promise<T> {
    if (this.query === null) throw new ApiError('NOT_READY');
    try {
      return await work(this.query);
    } catch (error) {
      if (error instanceof RecordingContextReadError) throw new ApiError(error.code);
      if (error instanceof RangeError && error.message === 'SESSION_PERFORMER_CURSOR_INVALID') {
        throw new ApiError('VALIDATION_FAILED');
      }
      throw error;
    }
  }
}
