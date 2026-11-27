import { afterAll, beforeAll, expect, it } from 'vitest';
import { Queue } from 'bullmq';
import { createOutboxDispatcherDatabase } from '@pospay/db';
import { createLogger } from '@pospay/observability';
import { PACKAGE_IMPORT_RECOVERY_QUEUE } from '../modules/orders/jobs/package-import-recovery.processor.ts';
import { startPackageImportCommitWorker } from '../modules/orders/index.ts';
import {
  packageImportCommitComposedFixture,
  type PackageImportCommitComposedFixture,
} from '../modules/orders/__tests__/package-import-commit-composed.fixture.ts';
import { discoverPackageRecoveries } from '../package-recovery-discovery.ts';

let f: PackageImportCommitComposedFixture;
let dispatcher: ReturnType<typeof createOutboxDispatcherDatabase>;

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

it('re-registers the import recovery sweep for the company with a commit request when Redis is empty', async () => {
  const prefix = `package-recovery-discovery-import-${f.ids.newId()}`;
  const worker = startPackageImportCommitWorker(f.db, f.ids, {
    redisUrl,
    clock: f.clock,
    transactionTimeoutMs: 30_000,
    prefix,
  });
  const queue = new Queue(PACKAGE_IMPORT_RECOVERY_QUEUE, {
    connection: { url: redisUrl },
    prefix,
  });
  try {
    await worker.ready();
    await f.commitRequested('discovery');
    expect(await queue.getJobSchedulers()).toEqual([]);
    const result = await discoverPackageRecoveries({
      listCompanies: (afterId, pageSize) => dispatcher.companyIdPage(afterId, pageSize),
      targets: [worker.recoveryTarget],
      logger: createLogger('error'),
    });
    expect(result.failures).toBe(0);
    expect(result.registered).toBe(1);
    const keys = (await queue.getJobSchedulers()).map((entry) => entry.key);
    expect(keys).toEqual([`package-import-recovery-${f.company}`]);
  } finally {
    await worker.close();
    await queue.obliterate({ force: true });
    await queue.close();
  }
}, 30_000);
