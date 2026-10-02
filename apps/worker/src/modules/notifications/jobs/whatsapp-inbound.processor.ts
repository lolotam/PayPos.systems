import { WHATSAPP_INBOX_ID, WHATSAPP_INBOUND_JOB } from '@pospay/notifications';
import type { Job } from 'bullmq';
import type { ProcessWhatsappInbox } from '../use-cases/process-whatsapp-inbox/process-whatsapp-inbox.ts';

export function whatsappInboundProcessor(process: ProcessWhatsappInbox) {
  return async (job: Pick<Job, 'data'> & { name?: string }): Promise<void> => {
    const data: unknown = job.data;
    if (
      (job.name !== undefined && job.name !== WHATSAPP_INBOUND_JOB) ||
      typeof data !== 'object' ||
      data === null ||
      Object.keys(data).length !== 1 ||
      !('inbox_id' in data) ||
      typeof data.inbox_id !== 'string' ||
      !WHATSAPP_INBOX_ID.test(data.inbox_id)
    )
      throw new Error('WHATSAPP_INBOX_JOB_INVALID');
    await process.execute(data.inbox_id);
  };
}
