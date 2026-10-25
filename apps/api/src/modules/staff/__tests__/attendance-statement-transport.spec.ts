import {
  DOCUMENTS_RENDER_QUEUE,
  DOCUMENT_RENDERER_ALIVE_KEY,
  documentStatusKey,
} from '@pospay/contracts';
import { Queue } from 'bullmq';
import { afterAll, beforeAll, expect, it } from 'vitest';

import { testRedis } from '../../../../test/harness.ts';
import { createDocumentRenderTransport } from '../persistence/bullmq-document-render-transport.ts';
import { salaryIds } from './salary.fixture.ts';

const redis = testRedis();
const prefix = `test-${salaryIds.newId()}`;
const companyId = salaryIds.newId();
const renderId = salaryIds.newId();
const filename = 'attendance-statement-branch-2026-10-01_2026-10-31.pdf';

let transport: ReturnType<typeof createDocumentRenderTransport>;
let queue: Queue;

beforeAll(() => {
  transport = createDocumentRenderTransport(redis, prefix);
  const connection = redis.duplicate({
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
    commandTimeout: 5000,
    keyPrefix: '',
  });
  queue = new Queue(DOCUMENTS_RENDER_QUEUE, { connection, prefix });
});
afterAll(async () => {
  await queue.close();
  await transport.close();
  await redis.quit();
});

it('queueing writes the queued status with its TTL and one job with the render id', async () => {
  await transport.queue({
    companyId,
    renderId,
    kind: 'attendance-statement',
    requestedBy: salaryIds.newId(),
    filename,
  });
  const hash = await redis.hgetall(documentStatusKey(companyId, renderId));
  expect(hash).toMatchObject({ state: 'QUEUED', filename });
  expect(hash['requested_by']).toBeTruthy();
  const ttl = await redis.ttl(documentStatusKey(companyId, renderId));
  expect(ttl).toBeGreaterThan(0);
  expect(ttl).toBeLessThanOrEqual(900);
  const job = await queue.getJob(renderId);
  expect(job?.data).toEqual({
    company_id: companyId,
    render_id: renderId,
    kind: 'attendance-statement',
  });
  expect(job?.id).toBe(renderId);
  expect(job?.opts.attempts).toBe(2);
});

it('a failed render leaves the status failed with its error code', async () => {
  const failedId = salaryIds.newId();
  await transport.markFailed(companyId, failedId);
  const hash = await redis.hgetall(documentStatusKey(companyId, failedId));
  expect(hash).toMatchObject({ state: 'FAILED', error_code: 'DOCUMENT_RENDER_FAILED' });
});

it('the renderer liveness follows the key and the previous value comes back', async () => {
  const previous = await redis.get(DOCUMENT_RENDERER_ALIVE_KEY);
  try {
    await redis.del(DOCUMENT_RENDERER_ALIVE_KEY);
    expect(await transport.rendererAlive()).toBe(false);
    await redis.set(DOCUMENT_RENDERER_ALIVE_KEY, '1', 'EX', 5);
    expect(await transport.rendererAlive()).toBe(true);
  } finally {
    if (previous === null) await redis.del(DOCUMENT_RENDERER_ALIVE_KEY);
    else await redis.set(DOCUMENT_RENDERER_ALIVE_KEY, previous);
  }
});
