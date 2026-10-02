export type { Channel, ChannelRequest, ChannelResult, TemplateComponent } from './channel.ts';
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
export { genericNotice, validInAppTemplate } from './templates/generic-notice.ts';
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
export { notificationRedisOptions } from './redis-connection.ts';

export {
  WHATSAPP_INBOUND_QUEUE,
  WHATSAPP_INBOUND_JOB,
  WHATSAPP_INBOX_ID,
  whatsappInboundJob,
  WhatsappQueueUnavailableError,
} from './whatsapp-inbound-queue.ts';
