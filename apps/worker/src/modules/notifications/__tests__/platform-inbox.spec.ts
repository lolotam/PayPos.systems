import { afterEach, beforeEach, expect, it } from 'vitest';
import { Queue } from 'bullmq';
import { systemUuidV7 } from '@pospay/ids';
import { notificationRedisOptions, whatsappInboundJob } from '@pospay/notifications';
import { platformHarness, redeliver } from './platform-harness.ts';
import { NOW, PHONE } from './harness.ts';
import { createWhatsappInboxRepository } from '../persistence/drizzle-whatsapp-inbox.repository.ts';
import { RecoverWhatsappInbox } from '../use-cases/recover-whatsapp-inbox/recover-whatsapp-inbox.ts';
import { ProcessWhatsappInbox } from '../use-cases/process-whatsapp-inbox/process-whatsapp-inbox.ts';
import { ClearWhatsappPayloads } from '../use-cases/clear-whatsapp-payloads/clear-whatsapp-payloads.ts';
import { whatsappInboundProcessor } from '../jobs/whatsapp-inbound.processor.ts';

let h: Awaited<ReturnType<typeof platformHarness>>;
let queue: Queue;
beforeEach(async () => {
  h = await platformHarness();
  queue = new Queue(`test-inbound-${systemUuidV7().newId()}`, {
    connection: notificationRedisOptions(
      process.env['REDIS_URL'] ??
        `redis://:${encodeURIComponent(process.env['REDIS_PASSWORD'] ?? '')}@127.0.0.1:6379`,
    ),
  });
  await redeliver(() => h.accept());
});
afterEach(async () => {
  await queue?.close();
  await h?.close();
});

it('recovers commit-before-enqueue/crash, and removed unprocessed jobs using UUID only', async () => {
  const [id] = await redeliver(() => h.accept());
  if (id === undefined) throw new Error('TEST_INBOX_MISSING');
  const repo = createWhatsappInboxRepository(h.global);
  const recover = new RecoverWhatsappInbox(
    repo,
    {
      enqueue: async (inboxId) => {
        const job = whatsappInboundJob(inboxId);
        await queue.add(job.name, job.data, job.options);
      },
    },
    h.clock,
  );
  expect(await queue.getJob(id)).toBeUndefined();
  await redeliver(() => recover.execute());
  const job = await queue.getJob(id);
  expect(job?.id).toBe(id);
  expect(job?.data).toEqual({ inbox_id: id });
  await job?.remove();
  await redeliver(() => recover.execute());
  const recreated = await queue.getJob(id);
  expect(recreated?.data).toEqual({ inbox_id: id });
  const before = await h.owner`SELECT * FROM platform_whatsapp_suppressions`;
  const process = whatsappInboundProcessor(new ProcessWhatsappInbox(repo, h.clock));
  await redeliver(() => process({ data: recreated?.data }));
  await redeliver(() => process({ data: recreated?.data }));
  await expect(process({ data: { inbox_id: id, phone: PHONE } })).rejects.toThrow(
    'WHATSAPP_INBOX_JOB_INVALID',
  );
  expect(await h.owner`SELECT * FROM platform_whatsapp_suppressions`).toEqual(before);
  expect(await h.owner`SELECT id FROM platform_whatsapp_audit`).toHaveLength(1);
  const [row] = await h.owner`SELECT processed_at FROM platform_whatsapp_inbox WHERE id=${id}`;
  expect(row?.['processed_at']).toEqual(NOW);
  await recreated?.remove();
});

it('clears JSON at 30 days only, then dedupes replay with permanent audit linkage', async () => {
  const repo = createWhatsappInboxRepository(h.global);
  const before =
    await h.owner`SELECT id,provider_message_digest,suppression_applied_at,processed_at,enqueue_confirmed_at FROM platform_whatsapp_inbox`;
  const suppression = await h.owner`SELECT * FROM platform_whatsapp_suppressions`;
  const audit = await h.owner`SELECT * FROM platform_whatsapp_audit`;
  const thirtyDays = 30 * 24 * 60 * 60 * 1000;
  const cleanup = (offset: number) =>
    new ClearWhatsappPayloads(repo, { now: () => new Date(NOW.getTime() + offset) }).execute();
  expect(await cleanup(thirtyDays - 1)).toBe(0);
  await redeliver(() => cleanup(thirtyDays));
  await redeliver(() => h.accept());
  expect(
    await h.owner`SELECT id,provider_message_digest,suppression_applied_at,processed_at,enqueue_confirmed_at FROM platform_whatsapp_inbox`,
  ).toEqual(before);
  expect(await h.owner`SELECT raw_event FROM platform_whatsapp_inbox`).toEqual([
    { raw_event: null },
  ]);
  expect(await h.owner`SELECT * FROM platform_whatsapp_audit`).toEqual(audit);
  expect(await h.owner`SELECT * FROM platform_whatsapp_suppressions`).toEqual(suppression);
});

it('rejects missing or unapplied STOP rows while preserving already processed idempotence', async () => {
  const repo = createWhatsappInboxRepository(h.global);
  await expect(repo.process(systemUuidV7().newId(), NOW)).rejects.toThrow(
    'WHATSAPP_INBOX_NOT_PROCESSABLE',
  );
  const [id] = await redeliver(() => h.accept());
  if (id === undefined) throw new Error('TEST_INBOX_MISSING');
  await h.owner`UPDATE platform_whatsapp_inbox SET suppression_applied_at = NULL WHERE id = ${id}`;
  await expect(repo.process(id, NOW)).rejects.toThrow('WHATSAPP_INBOX_NOT_PROCESSABLE');
  expect(await redeliver(() => repo.unfinished())).toContain(id);
});
