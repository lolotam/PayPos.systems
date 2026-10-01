import { expect, it } from 'vitest';
import {
  WHATSAPP_INBOUND_QUEUE,
  WHATSAPP_INBOUND_JOB,
  whatsappInboundJob,
} from '../whatsapp-inbound-queue.ts';

it('uses one UUID-only contract with stable dedupe and removable one-attempt jobs', () => {
  const id = '01900000-0000-7000-8000-000000000001';
  expect(WHATSAPP_INBOUND_QUEUE).toBe('notifications-inbound');
  expect(whatsappInboundJob(id)).toEqual({
    name: WHATSAPP_INBOUND_JOB,
    data: { inbox_id: id },
    options: { jobId: id, attempts: 1, removeOnComplete: true, removeOnFail: true },
  });
  expect(() => whatsappInboundJob('test-invalid')).toThrow('WHATSAPP_INBOX_JOB_INVALID');
});
