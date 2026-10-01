import { z } from 'zod';

export const whatsappHandshake = z
  .object({
    'hub.mode': z.literal('subscribe'),
    'hub.verify_token': z.string().min(1).max(512),
    'hub.challenge': z.string().min(1).max(256),
  })
  .meta({ id: 'WhatsappHandshake' });

export const whatsappMessage = z.object({
  id: z.string().min(1).max(2048),
  from: z.string().regex(/^[1-9]\d{7,14}$/),
  timestamp: z.string().regex(/^\d{1,11}$/),
  type: z.string().min(1).max(64),
  text: z.object({ body: z.string().max(1_048_576) }).optional(),
  button: z.object({ payload: z.string().max(256) }).optional(),
  interactive: z
    .object({
      type: z.string().max(64),
      button_reply: z.object({ id: z.string().max(256) }).optional(),
    })
    .optional(),
});

const providerId = z.string().min(1).max(32).regex(/^\d+$/);
export const whatsappEntry = z.object({ id: providerId, changes: z.array(z.unknown()) });
export const whatsappMessageChange = z.object({
  field: z.literal('messages'),
  value: z.object({
    messaging_product: z.literal('whatsapp'),
    metadata: z.object({ phone_number_id: providerId }),
    messages: z.array(z.unknown()).optional(),
  }),
});

export const whatsappEnvelope = z
  .object({
    object: z.literal('whatsapp_business_account'),
    entry: z.array(z.unknown()),
  })
  .meta({ id: 'WhatsappEnvelope' });

export type WhatsAppEnvelope = z.infer<typeof whatsappEnvelope>;

export const whatsappWebhookAcknowledgement = z
  .object({ received: z.literal(true) })
  .meta({ id: 'WhatsappWebhookAcknowledgement' });

/** خطأ بنيوي ثابت يمنع تسريب محتوى المزود أثناء رفض الغلاف. */
export class WhatsappEnvelopeInvalidError extends Error {
  /** يثبت نوع الخطأ دون الاحتفاظ بمحتوى الطلب. */
  constructor() {
    super('WHATSAPP_ENVELOPE_INVALID');
  }
}
