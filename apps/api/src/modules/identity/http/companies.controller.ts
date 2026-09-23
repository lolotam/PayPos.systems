import { Body, Controller, Inject, Post, Req, Res } from '@nestjs/common';
import { createCompanyInput, type CreateCompanyInput } from '@pospay/contracts';
import type { FastifyReply, FastifyRequest } from 'fastify';

import { ApiError } from '../../../shared/errors.ts';
import { Idempotency, type IdempotencyInput } from '../../../shared/idempotency.ts';
import { ZodValidationPipe } from '../../../shared/zod-validation.pipe.ts';
import { OnboardCompany, UnknownPlanError } from '../use-cases/onboard-company/onboard-company.ts';
import { RequirePlatform } from './access.decorators.ts';

@Controller('companies')
export class CompaniesController {
  readonly #onboard: OnboardCompany | null;

  constructor(@Inject(OnboardCompany) onboard: OnboardCompany | null) {
    this.#onboard = onboard;
  }

  @Post()
  @RequirePlatform('create:companies:platform')
  async create(
    @Body(new ZodValidationPipe(createCompanyInput)) input: CreateCompanyInput,
    @Idempotency() idempotency: IdempotencyInput,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<unknown> {
    const userId = request.principal?.userId;
    if (this.#onboard === null || userId === null || userId === undefined) {
      throw new ApiError('NOT_READY');
    }
    try {
      const result = await this.#onboard.execute({ userId, input, idempotency });
      void reply.status(result.status);
      if (result.replayed) void reply.header('idempotent-replayed', 'true');
      return result.body;
    } catch (error) {
      if (error instanceof UnknownPlanError) {
        throw new ApiError('VALIDATION_FAILED', [{ path: ['plan_id'], code: 'unknown_plan' }]);
      }
      throw error;
    }
  }
}
