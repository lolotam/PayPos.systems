import { expect, it } from 'vitest';
import { systemUuidV7 } from '@pospay/ids';
import { startStaffWorker } from '../staff.module.ts';

const ids = systemUuidV7();
const redisUrl =
  process.env['REDIS_URL'] ||
  `redis://:${process.env['REDIS_PASSWORD'] || 'pospay_dev_redis'}@127.0.0.1:6379`;

// ستارت العامل بلا أي إعداد اختياري: الوظيفة الجديدة لا تضيف متغيراً مطلوباً، والعامل يجهز ويغلق بنظافة.
it('starts the staff worker with optional settings empty and knows EmployeeDocumentRecorded', async () => {
  const database = {
    withTenant: async () => {
      throw new Error('unused in startup');
    },
  } as unknown as Parameters<typeof startStaffWorker>[0];
  const worker = startStaffWorker(
    database,
    ids,
    redisUrl,
    { now: () => new Date() },
    `staff-startup-test-${ids.newId()}`,
  );
  try {
    await worker.ready();
    expect(worker.eventTypes).toContain('EmployeeDocumentRecorded');
  } finally {
    await worker.close();
  }
});
