import { NotificationsController } from './http/notifications.controller.ts';
import type { Provider } from '@nestjs/common';
import type { TenantWrappers } from '@pospay/db';
import { SelectedCompanyGuard } from '../../shared/selected-company.guard.ts';
import {
  INBOX_WRITES,
  InAppNotificationsController,
} from './http/in-app-notifications.controller.ts';
import { createInAppRepository } from './persistence/drizzle-in-app.repository.ts';
import { MarkNotificationRead } from './use-cases/mark-notification-read/mark-notification-read.ts';
import { MarkAllNotificationsRead } from './use-cases/mark-all-notifications-read/mark-all-notifications-read.ts';

export const notificationsControllers = [NotificationsController, InAppNotificationsController];

export function notificationsProviders(database: TenantWrappers | undefined): Provider[] {
  const repository = database === undefined ? null : createInAppRepository(database);
  const clock = { now: () => new Date() };
  return [
    SelectedCompanyGuard,
    {
      provide: INBOX_WRITES,
      useValue:
        repository === null
          ? null
          : {
              read: new MarkNotificationRead(repository, clock),
              readAll: new MarkAllNotificationsRead(repository, clock),
            },
    },
  ];
}
