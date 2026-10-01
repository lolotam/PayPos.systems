import { WhatsappEnvelopeInvalidError } from '@pospay/contracts';
import {
  whatsappEntry,
  whatsappMessageChange,
  whatsappMessage,
  type WhatsAppEnvelope,
} from '@pospay/contracts';
import {
  createPhoneIdentity,
  createProviderMessageDigest,
  type WhatsappWebhookConfiguration,
} from '@pospay/notifications';
import {
  classifyWhatsappCommand,
  type ScrubbedWhatsappMessage,
} from '../domain/whatsapp-command.ts';

const TYPES = [
  'text',
  'button',
  'interactive',
  'image',
  'audio',
  'video',
  'document',
  'sticker',
  'location',
  'contacts',
  'reaction',
  'unknown',
  'system',
];

export function createWhatsappEnvelopeAdapter(
  config: WhatsappWebhookConfiguration,
  onSkipped: (count: number) => void = () => undefined,
) {
  const identity = createPhoneIdentity(config.phoneHashKey, config.hashKeyId);
  const digest = createProviderMessageDigest(config.messageHashKey, config.hashKeyId);
  return (envelope: WhatsAppEnvelope): ScrubbedWhatsappMessage[] => {
    const messages: ScrubbedWhatsappMessage[] = [];
    let skipped = 0;
    for (const input of envelope.entry) {
      const entry = whatsappEntry.safeParse(input);
      if (!entry.success || entry.data.id !== config.wabaId) {
        skipped++;
        continue;
      }
      for (const inputChange of entry.data.changes) {
        const change = whatsappMessageChange.safeParse(inputChange);
        if (
          !change.success ||
          change.data.value.metadata.phone_number_id !== config.phoneNumberId
        ) {
          skipped++;
          continue;
        }
        for (const inputMessage of change.data.value.messages ?? []) {
          const parsed = whatsappMessage.safeParse(inputMessage);
          if (!parsed.success) {
            skipped++;
            continue;
          }
          messages.push(scrubMessage(parsed.data, config, identity, digest));
        }
      }
    }
    if (skipped > 0) onSkipped(skipped);
    return messages;
  };
}

function scrubMessage(
  message: ReturnType<typeof whatsappMessage.parse>,
  config: WhatsappWebhookConfiguration,
  identity: ReturnType<typeof createPhoneIdentity>,
  digest: ReturnType<typeof createProviderMessageDigest>,
): ScrubbedWhatsappMessage {
  const phone = identity.identify(`+${message.from}`);
  const providerTimestamp = new Date(Number(message.timestamp) * 1000);
  if (!Number.isFinite(providerTimestamp.getTime())) throw new WhatsappEnvelopeInvalidError();
  const command = classifyWhatsappCommand(
    message.type,
    message.text?.body,
    message.type === 'button'
      ? message.button?.payload
      : message.interactive?.type === 'button_reply'
        ? message.interactive.button_reply?.id
        : undefined,
    config.stopButtonId,
  );
  const messageDigest = digest(message.id);
  return {
    digest: messageDigest,
    recipientHash: phone.hash,
    hashKeyId: config.hashKeyId,
    command,
    providerTimestamp,
    rawEvent: {
      object: 'whatsapp_business_account',
      waba_id: config.wabaId,
      phone_number_id: config.phoneNumberId,
      provider_message_digest: messageDigest.toString('hex'),
      recipient_hash: Buffer.from(phone.hash).toString('hex'),
      hash_key_id: config.hashKeyId,
      timestamp: providerTimestamp.toISOString(),
      type: TYPES.includes(message.type) ? message.type : 'unknown',
      command,
    },
  };
}
