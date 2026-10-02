import { WHATSAPP_PROVIDER_ID, NOTIFICATION_HASH_KEY_ID } from './identifier-patterns.ts';
export interface WhatsappWebhookConfiguration {
  readonly appSecret: string;
  readonly verifyToken: string;
  readonly wabaId: string;
  readonly phoneNumberId: string;
  readonly phoneHashKey: string;
  readonly messageHashKey: string;
  readonly hashKeyId: string;
  readonly stopButtonId?: string;
}

export function readWhatsappWebhookConfiguration(
  env: NodeJS.ProcessEnv,
): WhatsappWebhookConfiguration {
  const required = (name: string, min: number): string => {
    const value = env[name];
    if (value === undefined || value.length < min)
      throw new Error(`WHATSAPP_CONFIG_INVALID:${name}`);
    return value;
  };
  const wabaId = required('WHATSAPP_WABA_ID', 1);
  const phoneNumberId = required('WHATSAPP_PHONE_NUMBER_ID', 1);
  const hashKeyId = required('NOTIFICATION_PHONE_HASH_KEY_ID', 1);
  if (
    !WHATSAPP_PROVIDER_ID.test(wabaId) ||
    !WHATSAPP_PROVIDER_ID.test(phoneNumberId) ||
    !NOTIFICATION_HASH_KEY_ID.test(hashKeyId)
  )
    throw new Error('WHATSAPP_SENDER_CONFIG_INVALID');
  const stopButtonId = env['WHATSAPP_STOP_BUTTON_ID'] || undefined;
  if (stopButtonId !== undefined && !/^[a-zA-Z0-9_-]{1,128}$/.test(stopButtonId))
    throw new Error('WHATSAPP_STOP_BUTTON_CONFIG_INVALID');
  return {
    appSecret: required('WHATSAPP_APP_SECRET', 1),
    verifyToken: required('WHATSAPP_WEBHOOK_VERIFY_TOKEN', 1),
    phoneHashKey: required('NOTIFICATION_PHONE_HASH_KEY', 32),
    messageHashKey: required('NOTIFICATION_MESSAGE_ID_HASH_KEY', 32),
    hashKeyId,
    wabaId,
    phoneNumberId,
    ...(stopButtonId === undefined ? {} : { stopButtonId }),
  };
}
