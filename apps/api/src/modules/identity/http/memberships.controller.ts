import { Controller, HttpCode, Inject, Param, Post, Req } from '@nestjs/common';
import { id } from '@pospay/contracts';
import type { FastifyRequest } from 'fastify';

import { Require } from '../../../shared/access.decorators.ts';
import { actorOf } from '../../../shared/actor.ts';
import { ApiError } from '../../../shared/errors.ts';
import { ZodValidationPipe } from '../../../shared/zod-validation.pipe.ts';
import { EndMembership } from '../use-cases/end-membership/end-membership.ts';

@Controller('memberships')
export class MembershipsController {
  constructor(@Inject(EndMembership) private readonly endMembership: EndMembership | null) {}

  @Post(':membershipId/end')
  @HttpCode(200)
  @Require('manage:memberships:company')
  async end(
    @Param('membershipId', new ZodValidationPipe(id)) membershipId: string,
    @Req() request: FastifyRequest,
  ) {
    if (this.endMembership === null) throw new ApiError('NOT_READY');
    const actor = actorOf(request);
    return this.endMembership.execute({
      companyId: actor.companyId,
      actorUserId: actor.userId,
      membershipId,
    });
  }
}
