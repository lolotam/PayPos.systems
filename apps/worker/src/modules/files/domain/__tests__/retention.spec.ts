import { expect, it } from 'vitest';
import { retentionCutoff, retentionLeaseUntil, RETENTION_BATCH_SIZE } from '../retention.ts';
it('owner retention has exact UTC boundaries and a bounded recoverable lease', () => {
  const now = new Date('2026-10-10T12:00:00Z');
  expect(retentionCutoff('abandoned', now).toISOString()).toBe('2026-10-09T12:00:00.000Z');
  expect(retentionCutoff('rejected', now).toISOString()).toBe('2026-10-03T12:00:00.000Z');
  expect(retentionLeaseUntil(now).getTime() - now.getTime()).toBe(20 * 60 * 1000);
  expect(RETENTION_BATCH_SIZE).toBe(50);
});
