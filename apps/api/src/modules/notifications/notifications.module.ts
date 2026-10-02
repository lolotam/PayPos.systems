import {
  WHATSAPP_INBOUND_QUEUE,
  whatsappInboundJob,
  WhatsappQueueUnavailableError,
} from '@pospay/notifications';
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
import {
  WHATSAPP_WEBHOOK,
  WhatsappWebhookController,
  type WhatsappIntake,
} from './http/whatsapp-webhook.controller.ts';
import { Queue } from 'bullmq';
import type { PlatformWhatsappDatabase } from '@pospay/db';
import { systemUuidV7 } from '@pospay/ids';
import { readWhatsappWebhookConfiguration } from '@pospay/notifications';
import type { Logger } from '@pospay/observability';
import { createWhatsappEnvelopeAdapter } from './persistence/whatsapp-envelope.adapter.ts';
import { createWhatsappInboxRepository } from './persistence/drizzle-whatsapp-inbox.repository.ts';
import { ReceiveWhatsappStop } from './use-cases/receive-whatsapp-stop/receive-whatsapp-stop.ts';
import { notificationRedisOptions } from '@pospay/notifications';

export const notificationsControllers = [
  NotificationsController,
  InAppNotificationsController,
  WhatsappWebhookController,
];

export function notificationsProviders(
  database: TenantWrappers | undefined,
  whatsapp?: WhatsappIntake,
): Provider[] {
  const repository = database === undefined ? null : createInAppRepository(database);
  const clock = { now: () => new Date() };
  return [
    { provide: WHATSAPP_WEBHOOK, useValue: whatsapp ?? null },
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

export function createWhatsappIntake(
  database: PlatformWhatsappDatabase,
  redisUrl: string,
  env: NodeJS.ProcessEnv,
  logger: Logger,
) {
  const config = readWhatsappWebhookConfiguration(env);
  const queue = new Queue(WHATSAPP_INBOUND_QUEUE, {
    connection: {
      ...notificationRedisOptions(redisUrl),
      enableOfflineQueue: false,
      maxRetriesPerRequest: 1,
    },
  });
  queue.on('error', () => logger.warn({}, 'whatsapp inbox queue error'));
  const inbox = createWhatsappInboxRepository(database, systemUuidV7());
  const receive = new ReceiveWhatsappStop(
    inbox,
    {
      enqueue: async (id) => {
        const job = whatsappInboundJob(id);
        let timer: NodeJS.Timeout | undefined;
        try {
          await Promise.race([
            queue.add(job.name, job.data, job.options).catch(() => {
              throw new WhatsappQueueUnavailableError();
            }),
            new Promise<never>((_, reject) => {
              timer = setTimeout(() => reject(new WhatsappQueueUnavailableError()), 200);
            }),
          ]);
        } finally {
          clearTimeout(timer);
        }
      },
    },
    { now: () => new Date() },
  );
  return {
    config,
    receive,
    scrub: createWhatsappEnvelopeAdapter(config, (count) =>
      logger.warn({ skipped: count }, 'whatsapp changes skipped'),
    ),
    ready: async () => {
      await database.ping();
      await queue.waitUntilReady();
    },
    close: () => queue.close(),
  };
}
