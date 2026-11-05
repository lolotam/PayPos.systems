import { expect, it, vi } from 'vitest';
import { Queue } from 'bullmq';
import { packagePreviewFixture, SYNTHETIC_PHONE } from './package-preview.fixture.ts';
import { ExecutePackagePreview } from '../use-cases/execute-package-preview/execute-package-preview.ts';
import { packagePreviewTransactions } from '../persistence/package-preview.transactions.ts';
import { packagePreviewWorkbook } from '../persistence/package-preview-workbook.ts';
import {
  PACKAGE_PREVIEW_QUEUE,
  startPackagePreviewProcessor,
} from '../jobs/package-preview.processor.ts';

it('preserves a permanent parse error through failed persistence and processor restart', async () => {
  const setup = await failureFixture();
  const { f, queue, read } = setup;
  const { id } = await f.requested(new Uint8Array([1, 2, 3]));
  const eventId = f.ids.newId();
  try {
    await setup.processor.ready();
    expect(
      await setup.processor.deliver({
        id: eventId,
        companyId: f.company,
        aggregateId: id,
        aggregateType: 'import_preview',
        eventType: 'PackageImportPreviewRequested',
        payload: { preview_id: id },
        attempt: 1,
      }),
    ).toEqual({ delivered: true });
    await vi.waitFor(
      async () => {
        const job = await queue.getJob(eventId);
        expect(job?.progress).toEqual({
          stage: 'finalizing-preview-failure',
          code: 'IMPORT_FILE_CONTENT_INVALID',
        });
        expect(await job?.getState()).toBe('delayed');
        expect(job?.data).toEqual({ companyId: f.company, previewId: id });
        expect(JSON.stringify(job?.progress)).not.toContain(SYNTHETIC_PHONE);
      },
      { timeout: 10000 },
    );
    expect((await f.owner`SELECT status FROM import_previews WHERE id=${id}`)[0]?.['status']).toBe(
      'pending',
    );
    await setup.restart();
    await vi.waitFor(
      async () => {
        expect(
          (await f.owner`SELECT status,error_code FROM import_previews WHERE id=${id}`)[0],
        ).toMatchObject({
          status: 'failed',
          error_code: 'IMPORT_FILE_CONTENT_INVALID',
        });
      },
      { timeout: 10000 },
    );
    expect(read).toHaveBeenCalledTimes(1);
  } finally {
    await setup.close();
  }
}, 30000);

it('fails the trusted aggregate before parking an invalid event and retries if failure persistence is down', async () => {
  const setup = await failureFixture();
  const { f, queue, state } = setup;
  try {
    const trusted = await f.requested(new Uint8Array([1, 2, 3]));
    const redirected = await f.requested(new Uint8Array([1, 2, 3]));
    const event = {
      id: f.ids.newId(),
      companyId: f.company,
      aggregateId: trusted.id,
      aggregateType: 'import_preview',
      eventType: 'PackageImportPreviewRequested',
      payload: { preview_id: redirected.id },
      attempt: 1,
    };
    await setup.processor.ready();
    expect(await setup.processor.deliver(event)).toEqual({
      delivered: false,
      error: 'PACKAGE_PREVIEW_FAILURE_PERSIST_RETRY',
      retryInMs: 2000,
    });
    expect(
      (await f.owner`SELECT status FROM import_previews WHERE id=${trusted.id}`)[0]?.['status'],
    ).toBe('pending');
    state.available = true;
    expect(await setup.processor.deliver(event)).toEqual({
      delivered: false,
      error: 'PACKAGE_PREVIEW_EVENT_INVALID',
      retryInMs: null,
    });
    expect(
      (await f.owner`SELECT status,error_code FROM import_previews WHERE id=${trusted.id}`)[0],
    ).toMatchObject({
      status: 'failed',
      error_code: 'IMPORT_FILE_CONTENT_INVALID',
    });
    expect(
      (await f.owner`SELECT status FROM import_previews WHERE id=${redirected.id}`)[0]?.['status'],
    ).toBe('pending');
    expect(await queue.getJob(event.id)).toBeUndefined();
  } finally {
    await setup.close();
  }
});

async function failureFixture() {
  const f = await packagePreviewFixture();
  const redisUrl =
    process.env['REDIS_URL'] ||
    `redis://:${process.env['REDIS_PASSWORD'] || 'pospay_dev_redis'}@127.0.0.1:6379`;
  const prefix = `package-failure-test-${f.ids.newId()}`;
  const state = { available: false };
  const transactions = packagePreviewTransactions(f.database);
  const read = vi.fn(f.readBytes);
  const useCase = new ExecutePackagePreview(
    {
      ...transactions,
      fail: async (...args) => {
        if (!state.available) throw new Error(`Synthetic unavailable database ${SYNTHETIC_PHONE}`);
        return transactions.fail(...args);
      },
    },
    packagePreviewWorkbook(read),
    f.clock,
  );
  let processor = startPackagePreviewProcessor(useCase, redisUrl, prefix);
  const queue = new Queue(PACKAGE_PREVIEW_QUEUE, { connection: { url: redisUrl }, prefix });
  return {
    f,
    read,
    state,
    queue,
    get processor() {
      return processor;
    },
    restart: async () => {
      await processor.close();
      state.available = true;
      processor = startPackagePreviewProcessor(useCase, redisUrl, prefix);
      await processor.ready();
    },
    close: async () => {
      await processor.close();
      await queue.obliterate({ force: true });
      await queue.close();
      await f.close();
    },
  };
}
