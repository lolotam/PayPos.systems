export {
  createNotificationModule,
  startNotificationQueue,
  readNotificationConfiguration,
} from './notifications.module.ts';
export type { NotificationModuleOptions } from './notifications.module.ts';
export type {
  NotificationSendAuthorized,
  NotificationDelivered,
  NotificationFailed,
} from './events/published.ts';
export { createInAppNotificationModule } from './notifications.module.ts';
export { startWhatsappInbound } from './whatsapp-inbound.module.ts';
export { readPhoneHashConfiguration } from './team-alert-whatsapp.ts';
export type { PhoneHashConfiguration } from './team-alert-whatsapp.ts';
export type { Inbound } from './inbound.ts';
export { createEmailSendModule } from './notifications.module.ts';
export { startStaffOtpWorker } from './otp.module.ts';
export { startEmailCapability } from './email-startup.module.ts';
export { startPushCapability } from './push-startup.module.ts';
export type { PushCapability } from './push-startup.module.ts';
export { emailFeedbackProcessor } from './jobs/email-feedback.processor.ts';
export { emailMaintenanceProcessor } from './jobs/email-maintenance.processor.ts';
export { MAX_FEEDBACK_ATTEMPTS, MAX_FEEDBACK_BACKOFF_MS } from './domain/email-feedback.ts';
export type {
  AttemptBindingDecision,
  AttemptBindingSnapshot,
  EmailBounceClass,
  EmailFeedbackDecision,
  EmailFeedbackEventType,
  EmailQuarantineReason,
  EmailSuppressionReason,
  EmailSuppressionSource,
  RetrievedBindingTarget,
} from './domain/email-feedback.ts';
export type {
  EmailFeedbackInboxRepository,
  EmailFeedbackQueue,
  EmailFeedbackRow,
  EmailFeedbackSettleInput,
  EmailFeedbackSuppression,
  EmailFeedbackTenantInput,
  EmailFeedbackTenantOutcome,
  EmailFeedbackTenantRepository,
  EmailRetrievalPort,
} from './ports/email-feedback.port.ts';
