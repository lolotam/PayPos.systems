import {
  Controller,
  Get,
  Post,
  HttpCode,
  Inject,
  Param,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { id, inAppNotificationQuery, type InAppNotificationQuery } from '@pospay/contracts';
import type { TenantWrappers } from '@pospay/db';
import type { FastifyRequest } from 'fastify';

import { Authenticated } from '../../../shared/access.decorators.ts';
import { actorOf } from '../../../shared/actor.ts';
import { DATABASE } from '../../../shared/database.token.ts';
import { ApiError } from '../../../shared/errors.ts';
import { SelectedCompanyGuard } from '../../../shared/selected-company.guard.ts';
import { ZodValidationPipe } from '../../../shared/zod-validation.pipe.ts';
import {
  InvalidInAppCursorError,
  listInAppNotifications,
} from '../queries/in-app-notifications.query.ts';
import { unreadCount } from '../queries/unread-count.query.ts';
import type { MarkNotificationRead } from '../use-cases/mark-notification-read/mark-notification-read.ts';
import type { MarkAllNotificationsRead } from '../use-cases/mark-all-notifications-read/mark-all-notifications-read.ts';

export const INBOX_WRITES = Symbol('INBOX_WRITES');
export interface InboxWrites {
  readonly read: MarkNotificationRead;
  readonly readAll: MarkAllNotificationsRead;
}

@Controller('me/notifications')
@UseGuards(SelectedCompanyGuard)
export class InAppNotificationsController {
  constructor(
    @Inject(DATABASE) readonly database: TenantWrappers | null,
    @Inject(INBOX_WRITES) readonly writes: InboxWrites | null,
  ) {}

  @Get()
  @Authenticated()
  async list(
    @Req() request: FastifyRequest,
    @Query(new ZodValidationPipe(inAppNotificationQuery)) query: InAppNotificationQuery,
  ) {
    if (this.database === null) throw new ApiError('NOT_READY');
    try {
      return await listInAppNotifications(this.database, actorOf(request), query);
    } catch (error) {
      if (error instanceof InvalidInAppCursorError) throw new ApiError('BAD_REQUEST');
      throw error;
    }
  }

  @Get('unread-count')
  @Authenticated()
  count(@Req() request: FastifyRequest) {
    if (this.database === null) throw new ApiError('NOT_READY');
    return unreadCount(this.database, actorOf(request));
  }

  @Post(':id/read')
  @HttpCode(200)
  @Authenticated()
  read(
    @Req() request: FastifyRequest,
    @Param('id', new ZodValidationPipe(id)) notificationId: string,
  ) {
    if (this.writes === null) throw new ApiError('NOT_READY');
    return this.writes.read.execute(actorOf(request), notificationId);
  }

  @Post('read-all')
  @HttpCode(200)
  @Authenticated()
  readAll(@Req() request: FastifyRequest) {
    if (this.writes === null) throw new ApiError('NOT_READY');
    return this.writes.readAll.execute(actorOf(request));
  }
}
