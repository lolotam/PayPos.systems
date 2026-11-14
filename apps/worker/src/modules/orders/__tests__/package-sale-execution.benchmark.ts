import { afterAll, beforeAll, expect, it } from 'vitest';
import { appendFileSync } from 'node:fs';
import { cpus } from 'node:os';
import { packageSaleFixture, type PackageSaleFixture } from './package-sale.fixture.ts';

// مهلة معاملة البيع بتتمرر للعامل؛ القياس بيسجل الأزمنة بس ومفيش حد مطلق عليها (PP-165).
const TIMEOUT_MS = 30_000;
const WARMUPS = 1;
const RUNS = 5;

let f: PackageSaleFixture;

beforeAll(async () => {
  f = await packageSaleFixture();
});
afterAll(async () => {
  if (f) await f.close();
});

// التشغيل الاختياري بملف الإعداد هو اللي يختار المقياس ده؛ نمط src/**/*.spec.ts العادي بيستبعده.
it(
  'BENCHMARK records five complete 20 x 365 package sales',
  async () => {
    const type = await f.seedType({
      price: '20.000',
      validityDays: 365,
      components: Array.from({ length: 20 }, () => ({ sessions: 365, price: '1.000' })),
    });
    const [version] =
      await f.owner<{ version: string }[]>`SELECT current_setting('server_version') AS version`;
    const environment = {
      nodeVersion: process.version,
      postgresVersion: version?.version ?? 'unknown',
      platform: process.platform,
      cpuCount: cpus().length,
    };
    for (let run = 0; run < WARMUPS + RUNS; run++) {
      const requestId = await f.request({
        type,
        customer_id: f.customer,
        price_paid: '20.000',
      });
      const started = performance.now();
      await f.worker({ timeoutMs: TIMEOUT_MS }).execute(f.company, requestId);
      const durationMs = performance.now() - started;
      expect((await f.state(requestId)).status).toBe('completed');
      if (run < WARMUPS) continue;
      record({ durationMs, ...environment });
    }
  },
  600_000,
);

function record(value: unknown): void {
  const line = JSON.stringify(value);
  const destination = process.env['PACKAGE_SALE_BENCH_OUT'];
  if (destination) appendFileSync(destination, line + '\n');
  console.info(line);
}
