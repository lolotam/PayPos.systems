import {
  WHATSAPP_INBOUND_QUEUE,
  whatsappInboundJob,
  WhatsappQueueUnavailableError,
} from '@pospay/notifications';
import {
  EMAIL_FEEDBACK_QUEUE,
  EmailFeedbackQueueUnavailableError,
  emailFeedbackJob,
  readResendWebhookConfiguration,
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
import {
  RESEND_WEBHOOK,
  ResendWebhookController,
  type ResendIntake,
} from './http/resend-webhook.controller.ts';
import { createEmailFeedbackInboxRepository } from './persistence/drizzle-email-feedback.repository.ts';
import { ReceiveEmailFeedback } from './use-cases/receive-email-feedback/receive-email-feedback.ts';
import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import type { PlatformEmailDatabase, PlatformWhatsappDatabase } from '@pospay/db';
import { systemUuidV7 } from '@pospay/ids';
import { readWhatsappWebhookConfiguration } from '@pospay/notifications';
import type { Logger } from '@pospay/observability';
import { createWhatsappEnvelopeAdapter } from './persistence/whatsapp-envelope.adapter.ts';
import { createWhatsappInboxRepository } from './persistence/drizzle-whatsapp-inbox.repository.ts';
import { ReceiveWhatsappStop } from './use-cases/receive-whatsapp-stop/receive-whatsapp-stop.ts';
import {
  notificationRedisOptions,
  subscriberRef,
  type PushApiConfiguration,
} from '@pospay/notifications';
import { systemClock } from '../../shared/adapters/system-clock.ts';
import { RATE_LIMITER } from '../../shared/device-authenticator.ts';
import type { RateLimiter } from '../../shared/ports/rate-limiter.port.ts';
import {
  PUSH_CONFIG,
  PUSH_SUBSCRIBER_REF,
  PUSH_SUBSCRIPTION_WRITES,
  PushSubscriptionController,
} from './http/push-subscription.controller.ts';
import { createPushSubscriptionTransactions } from './persistence/drizzle-push-subscriptions.repository.ts';
import { createPushHashes } from './persistence/push-hashes.adapter.ts';
import { createPushKeys } from './persistence/push-keys.adapter.ts';
import { RegisterPushSubscription } from './use-cases/register-push-subscription/register-push-subscription.ts';
import { RevokePushSubscription } from './use-cases/revoke-push-subscription/revoke-push-subscription.ts';

export const notificationsControllers = [
  NotificationsController,
  InAppNotificationsController,
  WhatsappWebhookController,
  ResendWebhookController,
  PushSubscriptionController,
];

export function notificationsProviders(
  database: TenantWrappers | undefined,
  whatsapp?: WhatsappIntake,
  resend?: ResendIntake,
  push?: PushApiConfiguration | null,
): Provider[] {
  const repository = database === undefined ? null : createInAppRepository(database);
  const clock = { now: () => new Date() };
  return [
    { provide: WHATSAPP_WEBHOOK, useValue: whatsapp ?? null },
    { provide: RESEND_WEBHOOK, useValue: resend ?? null },
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
    { provide: PUSH_CONFIG, useValue: push ?? null },
    { provide: PUSH_SUBSCRIBER_REF, useValue: subscriberRef },
    {
      provide: PUSH_SUBSCRIPTION_WRITES,
      useFactory: (limiter: RateLimiter | null) => {
        const transactions =
          database === undefined ? null : createPushSubscriptionTransactions(database);
        if (transactions === null) return null;
        return {
          register: new RegisterPushSubscription(
            transactions,
            createPushHashes(),
            createPushKeys(),
            systemUuidV7(),
            systemClock,
            limiter,
          ),
          revoke: new RevokePushSubscription(transactions, createPushHashes(), systemClock),
        };
      },
      inject: [RATE_LIMITER],
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
  const { queue, close } = intakeQueue(redisUrl, logger, WHATSAPP_INBOUND_QUEUE);
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
  let closed = false;
  return {
    config,
    receive,
    scrub: createWhatsappEnvelopeAdapter(config, (count) =>
      logger.warn({ skipped: count }, 'whatsapp changes skipped'),
    ),
    ready: async () => {
      if (closed) throw new Error('WHATSAPP_CAPABILITY_UNAVAILABLE');
      await database.ping();
      if (closed) throw new Error('WHATSAPP_CAPABILITY_UNAVAILABLE');
      await queue.waitUntilReady();
    },
    close: async (force = false) => {
      closed = true;
      await close(force);
    },
  };
}

export function createResendIntake(
  database: PlatformEmailDatabase,
  redisUrl: string,
  env: NodeJS.ProcessEnv,
  logger: Logger,
) {
  const config = readResendWebhookConfiguration(env);
  const { queue, close } = intakeQueue(redisUrl, logger, EMAIL_FEEDBACK_QUEUE);
  queue.on('error', () => logger.warn({}, 'email feedback queue error'));
  const inbox = createEmailFeedbackInboxRepository(database, systemUuidV7());
  const clock = { now: () => new Date() };
  const receive = new ReceiveEmailFeedback(
    inbox,
    {
      enqueue: async (id) => {
        const job = emailFeedbackJob(id);
        let timer: NodeJS.Timeout | undefined;
        try {
          await Promise.race([
            queue.add(job.name, job.data, job.options).catch(() => {
              throw new EmailFeedbackQueueUnavailableError();
            }),
            new Promise<never>((_, reject) => {
              timer = setTimeout(() => reject(new EmailFeedbackQueueUnavailableError()), 200);
            }),
          ]);
        } finally {
          clearTimeout(timer);
        }
      },
    },
    clock,
  );
  let closed = false;
  return {
    config,
    receive,
    clock,
    ready: async () => {
      if (closed) throw new Error('EMAIL_FEEDBACK_CAPABILITY_UNAVAILABLE');
      await database.ping();
      if (closed) throw new Error('EMAIL_FEEDBACK_CAPABILITY_UNAVAILABLE');
      await queue.waitUntilReady();
    },
    close: async (force = false) => {
      closed = true;
      await close(force);
    },
  };
}

function intakeQueue(redisUrl: string, logger: Logger, name: string) {
  const connection = new Redis({
    ...notificationRedisOptions(redisUrl),
    enableOfflineQueue: false,
    maxRetriesPerRequest: 1,
  });
  connection.on('error', () => logger.warn({ queue: name }, 'intake queue error'));
  const queue = new Queue(name, { connection });
  return {
    queue,
    close: async (force: boolean) => {
      if (force) connection.disconnect();
      try {
        await queue.close();
      } finally {
        connection.disconnect();
      }
    },
  };
}
