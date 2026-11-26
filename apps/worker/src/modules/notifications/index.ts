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
export { createInAppNotificationModule, startWhatsappInbound } from './notifications.module.ts';
export { createEmailSendModule } from './notifications.module.ts';
export { startStaffOtpWorker } from './otp.module.ts';
export { startEmailCapability } from './email-startup.module.ts';
export { startPushCapability } from './push-startup.module.ts';
export type { PushCapability } from './push-startup.module.ts';
export { ReconcileEmailFeedback } from './use-cases/reconcile-email-feedback/reconcile-email-feedback.ts';
export { RecoverEmailFeedback } from './use-cases/recover-email-feedback/recover-email-feedback.ts';
export { ClearEmailFeedbackPayloads } from './use-cases/clear-email-feedback-payloads/clear-email-feedback-payloads.ts';
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
