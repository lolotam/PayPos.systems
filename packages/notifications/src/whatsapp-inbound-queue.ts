export const WHATSAPP_INBOUND_QUEUE = 'notifications-inbound';
export const WHATSAPP_INBOUND_JOB = 'process-inbox';
export const WHATSAPP_INBOX_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function whatsappInboundJob(id: string) {
  if (!WHATSAPP_INBOX_ID.test(id)) throw new Error('WHATSAPP_INBOX_JOB_INVALID');
  return {
    name: WHATSAPP_INBOUND_JOB,
    data: { inbox_id: id },
    options: { jobId: id, attempts: 1, removeOnComplete: true, removeOnFail: true },
  };
}

export class WhatsappQueueUnavailableError extends Error {
  constructor() {
    super('WHATSAPP_QUEUE_UNAVAILABLE');
    this.name = 'WhatsappQueueUnavailableError';
  }
}
