import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Inject,
  Post,
  Put,
  Req,
  SetMetadata,
} from '@nestjs/common';
import {
  pushRevokeInput,
  pushSubscriptionInput,
  type PushConfig,
  type PushRevokeInput,
  type PushSubscriptionInput,
} from '@pospay/contracts';
import type { PushApiConfiguration } from '@pospay/notifications';
import type { FastifyRequest } from 'fastify';

import { Authenticated } from '../../../shared/access.decorators.ts';
import { ApiError } from '../../../shared/errors.ts';
import { PERSONAL_ROUTE } from '../../../shared/personal-authentication.ts';
import { ZodValidationPipe } from '../../../shared/zod-validation.pipe.ts';
import { pushConfigFor } from '../queries/push-config.query.ts';
import type { RegisterPushSubscription } from '../use-cases/register-push-subscription/register-push-subscription.ts';
import type { RevokePushSubscription } from '../use-cases/revoke-push-subscription/revoke-push-subscription.ts';

export const PUSH_CONFIG = Symbol('PUSH_CONFIG');
export const PUSH_SUBSCRIBER_REF = Symbol('PUSH_SUBSCRIBER_REF');
export const PUSH_SUBSCRIPTION_WRITES = Symbol('PUSH_SUBSCRIPTION_WRITES');

/** حالة كتابة اشتراكات الدفع: التسجيل والإلغاء. */
export interface PushSubscriptionWrites {
  readonly register: RegisterPushSubscription;
  readonly revoke: RevokePushSubscription;
}

@Controller('staff/push')
export class PushSubscriptionController {
  constructor(
    @Inject(PUSH_SUBSCRIPTION_WRITES) private readonly writes: PushSubscriptionWrites | null,
    @Inject(PUSH_CONFIG) private readonly push: PushApiConfiguration | null,
    @Inject(PUSH_SUBSCRIBER_REF) private readonly subscriberRef: (userId: string) => string,
  ) {}

  @Get('config')
  @Authenticated()
  @SetMetadata(PERSONAL_ROUTE, true)
  @Header('Cache-Control', 'no-store')
  async config(@Req() request: FastifyRequest): Promise<PushConfig> {
    const scope = scopeOf(request);
    const config = pushConfigFor(this.push, scope.userId, this.subscriberRef);
    if (config === null) throw new ApiError('NOT_READY');
    return config;
  }

  @Put('subscription')
  @Authenticated()
  @SetMetadata(PERSONAL_ROUTE, true)
  @HttpCode(204)
  @Header('Cache-Control', 'no-store')
  async register(
    @Body(new ZodValidationPipe(pushSubscriptionInput)) input: PushSubscriptionInput,
    @Req() request: FastifyRequest,
  ): Promise<void> {
    if (this.writes === null) throw new ApiError('NOT_READY');
    await this.writes.register.execute(scopeOf(request), input, this.push);
  }

  @Post('subscription/revoke')
  @Authenticated()
  @SetMetadata(PERSONAL_ROUTE, true)
  @HttpCode(204)
  @Header('Cache-Control', 'no-store')
  async revoke(
    @Body(new ZodValidationPipe(pushRevokeInput)) input: PushRevokeInput,
    @Req() request: FastifyRequest,
  ): Promise<void> {
    if (this.writes === null) throw new ApiError('NOT_READY');
    await this.writes.revoke.execute(scopeOf(request), input);
  }
}

function scopeOf(request: FastifyRequest): { companyId: string; userId: string } {
  const session = request.personalSession;
  if (session === undefined) throw new ApiError('UNAUTHENTICATED');
  return { companyId: session.context.companyId, userId: session.userId };
}
