import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { Queue } from 'bullmq';
import { createOutboxDispatcherDatabase, type OutboxDispatcherDatabase } from '@pospay/db';
import { systemUuidV7 } from '@pospay/ids';
import { PACKAGE_IMPORT_COMMIT_QUEUE } from '../jobs/package-import-commit.processor.ts';
import { startPackageImportCommitWorker } from '../index.ts';
import {
  packageImportCommitComposedFixture,
  type PackageImportCommitComposedFixture,
} from './package-import-commit-composed.fixture.ts';

let f: PackageImportCommitComposedFixture;
let dispatcher: OutboxDispatcherDatabase;

beforeAll(async () => {
  f = await packageImportCommitComposedFixture();
  dispatcher = createOutboxDispatcherDatabase({ url: f.dispatcherUrl, maxConnections: 1 });
});
afterAll(async () => {
  await dispatcher?.close();
  if (f) await f.close();
});

const redisUrl =
  process.env['REDIS_URL'] ||
  `redis://:${process.env['REDIS_PASSWORD'] || 'pospay_dev_redis'}@127.0.0.1:6379`;

/** يلوحظ إضافة المهمة على طابور التثبيت لحادثة محددة مع تشغيل الإضافة الحقيقية بعد الالتقاط. */
function observeAdd(
  prefix: string,
  eventId: string,
  before: () => Promise<void>,
): ReturnType<typeof vi.spyOn> {
  const originalAdd = Queue.prototype.add;
  return vi.spyOn(Queue.prototype, 'add').mockImplementation(async function (
    this: Queue,
    ...args: Parameters<Queue['add']>
  ) {
    if (
      this.name === PACKAGE_IMPORT_COMMIT_QUEUE &&
      this.opts.prefix === prefix &&
      args[2]?.jobId === eventId
    )
      await before();
    return originalAdd.apply(this, args);
  });
}

it('the dispatcher claim is committed before the queue add and the delivery stores the money once', async () => {
  const ids = systemUuidV7();
  const prefix = `package-import-commit-dispatch-${ids.newId()}`;
  const worker = startPackageImportCommitWorker(f.db, f.ids, {
    redisUrl,
    clock: f.clock,
    transactionTimeoutMs: 30_000,
    prefix,
  });
  const queue = new Queue(PACKAGE_IMPORT_COMMIT_QUEUE, { connection: { url: redisUrl }, prefix });
  const previewId = await f.commitRequested('dispatch');
  const eventId = ids.newId();
  await f.owner`INSERT INTO outbox(company_id,id,aggregate_type,aggregate_id,event_type,payload,attempts,next_attempt_at)
    VALUES(${f.company},${eventId},'import_preview',${previewId},'PackageImportCommitRequested',
      ${f.owner.json({ preview_id: previewId })},0,clock_timestamp())`;
  let claim: { attempts: number; published: boolean; leased: boolean } | undefined;
  const add = observeAdd(prefix, eventId, async () => {
    const [row] = await f.owner`SELECT attempts, published_at,
      (next_attempt_at > clock_timestamp()) AS leased FROM outbox WHERE id=${eventId}`;
    claim = {
      attempts: Number(row?.['attempts']),
      published: row?.['published_at'] !== null,
      leased: row?.['leased'] === true,
    };
  });
  try {
    await worker.ready();
    const dispatched = await dispatcher.dispatchBatch(10, (event) =>
      worker.deliver(event, async () => ({ delivered: true })),
    );
    expect(dispatched).toBe(1);
    // اتصال owner مستقل قرأ الـ claim قبل الإضافة الحقيقية: عداد المحاولة مكتوب، الحجز سارٍ، والنشر لم يقع بعد (ADR-0018).
    expect(claim).toEqual({ attempts: 1, published: false, leased: true });
    await vi.waitFor(
      async () => {
        const [row] = await f.owner`SELECT published_at FROM outbox WHERE id=${eventId}`;
        expect(row?.['published_at']).not.toBeNull();
        const [status] = await f.owner`SELECT status FROM import_previews WHERE id=${previewId}`;
        expect(status?.['status']).toBe('committed');
      },
      { timeout: 20000 },
    );
    expect(await f.moneyCounts(previewId)).toEqual({
      entitlements: 1,
      slots: 730,
      audits: 1,
      events: 1,
    });
  } finally {
    add.mockRestore();
    await worker.close();
    await queue.obliterate({ force: true });
    await queue.close();
  }
}, 40000);

it('redelivering the same event after the first job completed and was removed enqueues a new job and keeps the money single', async () => {
  const ids = systemUuidV7();
  const prefix = `package-import-commit-redelivery-${ids.newId()}`;
  const worker = startPackageImportCommitWorker(f.db, f.ids, {
    redisUrl,
    clock: f.clock,
    transactionTimeoutMs: 30_000,
    prefix,
  });
  const queue = new Queue(PACKAGE_IMPORT_COMMIT_QUEUE, { connection: { url: redisUrl }, prefix });
  const previewId = await f.commitRequested('redelivery-removal');
  const eventId = ids.newId();
  const claimed = f.commitEvent(previewId, { id: eventId });
  try {
    await worker.ready();
    expect(await worker.deliver(claimed, async () => ({ delivered: true }))).toEqual({
      delivered: true,
    });
    await vi.waitFor(
      async () => {
        const [status] = await f.owner`SELECT status FROM import_previews WHERE id=${previewId}`;
        expect(status?.['status']).toBe('committed');
        expect(await queue.getJob(eventId)).toBeUndefined();
      },
      { timeout: 20000 },
    );
    const before = await f.moneyCounts(previewId);
    expect(before).toEqual({ entitlements: 1, slots: 730, audits: 1, events: 1 });
    let enqueued = false;
    const add = observeAdd(prefix, eventId, async () => {
      enqueued = true;
    });
    try {
      expect(await worker.deliver(claimed, async () => ({ delivered: true }))).toEqual({
        delivered: true,
      });
      expect(enqueued).toBe(true);
      await vi.waitFor(async () => expect(await queue.getJob(eventId)).toBeUndefined(), {
        timeout: 20000,
      });
      expect(await f.moneyCounts(previewId)).toEqual(before);
    } finally {
      add.mockRestore();
    }
  } finally {
    await worker.close();
    await queue.obliterate({ force: true });
    await queue.close();
  }
}, 45000);
