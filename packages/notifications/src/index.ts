export type { Channel, ChannelRequest, ChannelResult, TemplateComponent } from './channel.ts';
export { ResendChannel } from './adapters/resend.channel.ts';
export { createResendEmailRetriever } from './adapters/resend-retrieval.ts';
export type {
  ResendEmailRetriever,
  ResendRetrievalOptions,
  ResendRetrievalResult,
  RetrievedEmailTags,
} from './adapters/resend-retrieval.ts';
export type { EmailRequest } from './email-request.ts';
export { createEmailIdentity, canonicalEmail } from './email-identity.ts';
export { readEmailConfiguration } from './email-configuration.ts';
export type { EmailConfiguration, EmailDisabledReason } from './email-configuration.ts';
export { OPERATIONAL_EMAIL_KEYS, renderOperationalEmail } from './templates/email-operational.ts';
export type { EmailContent, OperationalEmailKey } from './templates/email-operational.ts';
export { renderEmailLayout, EmailLayoutError } from './templates/email-layout.ts';
export type { EmailLayout, EmailLayoutInput } from './templates/email-layout.ts';
export {
  GRAPH_API_VERSION,
  readNotificationConfiguration,
  createTemplateRegistry,
} from './configuration.ts';
export type { NotificationConfiguration, TemplatePreparation } from './configuration.ts';
export { createPhoneIdentity, phoneLockKey } from './phone-identity.ts';
export type { PhoneIdentity } from './phone-identity.ts';
export { FakeChannel } from './adapters/fake.channel.ts';
export type { FakeOutcome, FakeChannelHooks } from './adapters/fake.channel.ts';
export { WhatsAppChannel } from './adapters/whatsapp.channel.ts';
export { staffOtp } from './templates/staff-otp.ts';
export {
  PASSWORD_RESET_OTP_KEY,
  PASSWORD_RESET_OTP_REVISION,
  renderPasswordResetEmail,
  type PasswordResetEmail,
} from './templates/password-reset-otp.ts';
export {
  renderStaffPinResetEmail,
  STAFF_PIN_RESET_OTP_KEY,
  STAFF_PIN_RESET_OTP_REVISION,
} from './templates/staff-pin-reset-otp.ts';
export { ratingRequest } from './templates/rating-request.ts';
export { genericNotice, validInAppTemplate } from './templates/generic-notice.ts';
export { lateServiceSession } from './templates/late-service-session.ts';
export { serviceLinePriceEdited } from './templates/service-line-price-edited.ts';
export { serviceLineCancelled } from './templates/service-line-cancelled.ts';
export { packageRefundRecorded } from './templates/package-refund-recorded.ts';
export { serviceLinePerformersChanged } from './templates/service-line-performers-changed.ts';
export { discountApprovalRequested } from './templates/discount-approval-requested.ts';
export { discountSelfApproved } from './templates/discount-self-approved.ts';
export { commissionCorrectionBlocked } from './templates/commission-correction-blocked.ts';
export { commissionEventParked } from './templates/commission-event-parked.ts';
export { statementAwaitingApproval } from './templates/statement-awaiting-approval.ts';
export { statementAwaitingReview } from './templates/statement-awaiting-review.ts';
export { shiftNotClockedIn } from './templates/shift-not-clocked-in.ts';
export { attendanceExceptionRaised } from './templates/attendance-exception-raised.ts';
export { documentExpiring } from './templates/document-expiring.ts';
export {
  staffAccessGranted,
  staffPinRecovered,
  staffPinSetByOther,
} from './templates/staff-access-notice.ts';
export { breakNotReturned } from './templates/break-not-returned.ts';
export {
  lowRating,
  lowRatingWithComment,
  validLowRatingTemplate,
  type LowRatingDetailsParameter,
  type LowRatingTemplateDefinition,
} from './templates/low-rating.ts';
export { validateParameters, templateComponents } from './templates/definition.ts';
export type {
  TemplateDefinition,
  TemplateParameter,
  SafeParameter,
} from './templates/definition.ts';
export {
  createProviderMessageDigest,
  WhatsappDigestUnavailableError,
  verifyWhatsappSignature,
  verifyWhatsappToken,
} from './provider-message-identity.ts';
export {
  readWhatsappWebhookConfiguration,
  type WhatsappWebhookConfiguration,
} from './webhook-configuration.ts';
export {
  createResendEventDigest,
  readResendWebhookConfiguration,
  resendBounceClass,
  resendSigningKey,
  verifyResendSignature,
  RESEND_INTAKE_BUDGET_MS,
  RESEND_TIMESTAMP_WINDOW_SECONDS,
  type ResendWebhookConfiguration,
  type ResendWebhookHeaders,
} from './resend-webhook.ts';
export {
  EMAIL_FEEDBACK_INBOX_ID,
  EMAIL_FEEDBACK_JOB,
  EMAIL_FEEDBACK_QUEUE,
  emailFeedbackJob,
} from './email-feedback-queue.ts';
export { notificationRedisOptions } from './redis-connection.ts';

export {
  WHATSAPP_INBOUND_QUEUE,
  WHATSAPP_INBOUND_JOB,
  WHATSAPP_INBOX_ID,
  whatsappInboundJob,
  WhatsappQueueUnavailableError,
} from './whatsapp-inbound-queue.ts';
export {
  readOtpTemplateApproval,
  prepareStaffOtp,
  type OtpTemplateApproval,
} from './templates/staff-otp-preparation.ts';
export { installationHash, endpointHash, subscriberRef, vapidKeyId } from './push/hashes.ts';
export { readPushApiConfiguration, type PushApiConfiguration } from './push/configuration.ts';
export {
  validPushTemplate,
  sanitizePushParameters,
  renderPushNotice,
  type PushTemplateDefinition,
  type PushTemplateCopy,
} from './push/templates.ts';
export type { PushChannel, PushRequest, PushResult, PushTarget } from './push/channel.ts';
export {
  buildPushPayload,
  pushTimeToLiveSeconds,
  pushTopic,
  PUSH_PAYLOAD_LIMIT_BYTES,
  PUSH_DEFAULT_TTL_SECONDS,
  PUSH_APP_PATH,
} from './push/payload.ts';
export { generateVapidKeyPair } from './push/vapid-keys.ts';
export { isValidSubscriptionKeys } from './push/subscription-keys.ts';
export { readPushWorkerConfiguration } from './push/worker-configuration.ts';
export type {
  PushWorkerConfiguration,
  PushWorkerReadiness,
  PushDisabledReason,
} from './push/worker-configuration.ts';
export { WebPushChannel } from './adapters/web-push.channel.ts';
export type { WebPushSender } from './adapters/web-push.channel.ts';
export { FakePushChannel } from './adapters/fake-push.channel.ts';
export type { FakePushOutcome } from './adapters/fake-push.channel.ts';
