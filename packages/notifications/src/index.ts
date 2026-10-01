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
