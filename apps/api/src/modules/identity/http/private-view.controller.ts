import { Body, Controller, Header, HttpCode, Inject, Post, Req, SetMetadata } from '@nestjs/common';
import { RouteConfig } from '@nestjs/platform-fastify';
import type { PrivateViewFacade, StaffSession } from '@pospay/auth';
import {
  PRIVATE_VIEW_WINDOW_HEADER,
  privateViewOpenInput,
  type PrivateViewOpenInput,
  type PrivateViewTouch,
  type PrivateViewWindow,
} from '@pospay/contracts';
import type { FastifyRequest } from 'fastify';

import { Authenticated } from '../../../shared/access.decorators.ts';
import { ApiError } from '../../../shared/errors.ts';
import {
  PrivateViewRoute,
  privateViewScope,
  privateViewWindowId,
} from '../../../shared/private-view.guard.ts';
import { STAFF_AUTH_BODY_BYTES } from '../../../shared/staff-input-limits.ts';
import { STAFF_ROUTE } from '../../../shared/staff-authentication.ts';
import {
  isStaffOrigin,
  STAFF_POS_ORIGIN,
  type StaffOrigins,
} from '../../../shared/staff-origin.token.ts';
import { ZodValidationPipe } from '../../../shared/zod-validation.pipe.ts';
import { OpenPrivateView } from '../use-cases/open-private-view/open-private-view.ts';

// توكن نافذة العرض الخاص: طبقة الـ http ما بتستوردش المنافذ، فالتعريف هنا مع مستهلكه والربط في الوحدة.
export const PRIVATE_VIEW_WINDOWS = Symbol('PRIVATE_VIEW_WINDOWS');

/** مسارات نافذة العرض الخاص على جهاز الفرع (spec 060 D-A13): كلها بعد جلسة الموظف وبمصدر الـ POS. */
@Controller('staff/me/private-view')
export class PrivateViewController {
  constructor(
    @Inject(OpenPrivateView) private readonly views: OpenPrivateView | null,
    @Inject(PRIVATE_VIEW_WINDOWS) private readonly windows: Pick<PrivateViewFacade, 'close'> | null,
    @Inject(STAFF_POS_ORIGIN) private readonly origin: StaffOrigins | null,
  ) {}

  @Post()
  @RouteConfig({ bodyLimit: STAFF_AUTH_BODY_BYTES })
  @Authenticated()
  @SetMetadata(STAFF_ROUTE, 'staff')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  async open(
    @Body(new ZodValidationPipe(privateViewOpenInput)) input: PrivateViewOpenInput,
    @Req() request: FastifyRequest,
  ): Promise<PrivateViewWindow> {
    const session = this.staffSession(request);
    if (this.views === null) throw new ApiError('NOT_READY');
    const result = await this.views.execute({ pin: input.pin, session }).catch((error: unknown) => {
      if (error instanceof Error && error.message === 'STAFF_PIN_UNAVAILABLE') {
        request.log.warn(
          { capability: 'PRIVATE_VIEW', state: 'UNAVAILABLE', reason: 'OPERATION_FAILED' },
          'private view capability',
        );
        throw new ApiError('NOT_READY');
      }
      throw error;
    });
    if (result.kind !== 'opened') throw new ApiError('PIN_INVALID');
    return {
      window_id: result.windowId,
      window_seq: result.windowSeq,
      session_ref: result.sessionRef,
      idle_remaining_ms: result.idleRemainingMs,
      cap_remaining_ms: result.capRemainingMs,
    };
  }

  @Post('touch')
  @RouteConfig({ bodyLimit: STAFF_AUTH_BODY_BYTES })
  @PrivateViewRoute()
  @Authenticated()
  @SetMetadata(STAFF_ROUTE, 'staff')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  async touch(@Req() request: FastifyRequest): Promise<PrivateViewTouch> {
    this.staffSession(request);
    const view = request.privateView;
    if (view === undefined) throw new ApiError('PRIVATE_VIEW_EXPIRED');
    return {
      idle_remaining_ms: view.idleRemainingMs,
      cap_remaining_ms: view.capRemainingMs,
    };
  }

  @Post('close')
  @RouteConfig({ bodyLimit: STAFF_AUTH_BODY_BYTES })
  @Authenticated()
  @SetMetadata(STAFF_ROUTE, 'staff')
  @HttpCode(204)
  @Header('Cache-Control', 'no-store')
  async close(@Req() request: FastifyRequest): Promise<void> {
    const session = this.staffSession(request);
    const windowId = privateViewWindowId(request.headers[PRIVATE_VIEW_WINDOW_HEADER]);
    if (windowId === null) return;
    if (this.windows === null) throw new ApiError('NOT_READY');
    await this.windows.close(privateViewScope(session), windowId);
  }

  private staffSession(request: FastifyRequest): StaffSession {
    if (!isStaffOrigin(this.origin, request.headers.origin)) throw new ApiError('FORBIDDEN');
    const session = request.staffSession;
    if (session === undefined) throw new ApiError('UNAUTHENTICATED');
    return session;
  }
}
