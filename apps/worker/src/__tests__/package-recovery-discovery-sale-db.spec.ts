import { afterAll, beforeAll, expect, it } from 'vitest';
import { Queue } from 'bullmq';
import { createLogger } from '@pospay/observability';
import { PACKAGE_SALE_RECOVERY_QUEUE } from '../modules/orders/jobs/package-sale-recovery.processor.ts';
import { startPackageSaleWorker } from '../modules/orders/index.ts';
import {
  packageSaleFixture,
  type PackageSaleFixture,
} from '../modules/orders/__tests__/package-sale.fixture.ts';
import { discoverPackageRecoveries } from '../package-recovery-discovery.ts';

let f: PackageSaleFixture;

beforeAll(async () => {
  f = await packageSaleFixture();
});
afterAll(async () => {
  if (f) await f.close();
});

const redisUrl =
  process.env['REDIS_URL'] ||
  `redis://:${process.env['REDIS_PASSWORD'] || 'pospay_dev_redis'}@127.0.0.1:6379`;

async function scanWithEmptyRedis(prefix: string) {
  const worker = startPackageSaleWorker(f.database, f.ids, {
    redisUrl,
    clock: f.clock,
    transactionTimeoutMs: 30_000,
    prefix,
  });
  const queue = new Queue(PACKAGE_SALE_RECOVERY_QUEUE, { connection: { url: redisUrl }, prefix });
  try {
    await worker.ready();
    expect(await queue.getJobSchedulers()).toEqual([]);
    const result = await discoverPackageRecoveries({
      listCompanies: async (afterId) => (afterId === null ? [f.company, f.otherCompany] : []),
      targets: [worker.recoveryTarget],
      logger: createLogger('error'),
    });
    const keys = (await queue.getJobSchedulers()).map((entry) => entry.key);
    return { result, keys };
  } finally {
    await worker.close();
    await queue.obliterate({ force: true });
    await queue.close();
  }
}

it('re-registers the sale recovery sweep only for a company with a pending request when Redis is empty', async () => {
  const type = await f.seedType({
    price: '25.000',
    validityDays: 90,
    components: [{ sessions: 10, price: '3.000' }],
  });
  const requestId = await f.request({ type });
  const { result, keys } = await scanWithEmptyRedis(
    `package-recovery-discovery-sale-${f.ids.newId()}`,
  );
  expect(result).toEqual({ companies: 2, registered: 1, failures: 0 });
  expect(keys).toEqual([`package-sale-recovery-${f.company}`]);
  await f.owner`UPDATE package_sale_requests SET status='failed',error_code='PACKAGE_SALE_FAILED',finished_at=now()
    WHERE company_id=${f.company} AND id=${requestId}`;
}, 30_000);

it('registers nothing once no request is pending', async () => {
  const { result, keys } = await scanWithEmptyRedis(
    `package-recovery-discovery-sale-done-${f.ids.newId()}`,
  );
  expect(result).toEqual({ companies: 2, registered: 0, failures: 0 });
  expect(keys).toEqual([]);
}, 30_000);
