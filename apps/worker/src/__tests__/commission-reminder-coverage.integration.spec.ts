import { createOutboxDispatcherDatabase, type OutboxDispatcherDatabase } from '@pospay/db';
import {
  commissionStatementReminderQueue,
  commissionStatementReminderSchedulerId,
} from '@pospay/contracts';
import { COMMISSION_REMINDER_ALERT_SCHEDULER_RESTORED } from '@pospay/domain';
import { systemUuidV7 } from '@pospay/ids';
import { createLogger } from '@pospay/observability';
import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import postgres from 'postgres';
import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';

import { seedTwoTenants, TENANT } from '../../../../packages/db/test/tenancy-fixtures.ts';
import {
  createTestDatabase,
  type TestDatabase,
} from '../../../../packages/db/test/test-database.ts';
import {
  checkCommissionReminderReadiness,
  createCommissionReminderCoverageSweeper,
  createCommissionReminderSchedule,
  createReminderRecoveryStore,
  recoverCommissionReminders,
  reminderRecoveryReaders,
  REMINDER_RECOVERY_KEY,
  REMINDER_RECOVERY_SLOT_KEY,
  REMINDER_SENTINEL_KEY,
  type RecoverCommissionRemindersDeps,
} from '../modules/commissions/index.ts';

// Redis حقيقي على بادئة خاصة بالاختبار؛ مفاتيح الاستعادة الثلاثة بتتمسح بالاسم بس (بدون أي FLUSH).
const REDIS_URL =
  process.env['COMMISSION_REMINDER_TEST_REDIS_URL'] ||
  process.env['REDIS_URL'] ||
  `redis://:${process.env['REDIS_PASSWORD'] || 'pospay_dev_redis'}@127.0.0.1:6379`;
const PREFIX = `test-coverage-${Math.random().toString(16).slice(2, 10)}`;
const A = TENANT.A;
const B = TENANT.B;
const ids = systemUuidV7();
const silent = createLogger('silent');

let testDb: TestDatabase;
let owner: postgres.Sql;
let dispatcher: OutboxDispatcherDatabase;
let redis: Redis;
let queue: Queue;
let schedule: ReturnType<typeof createCommissionReminderSchedule>;

beforeAll(async () => {
  testDb = await createTestDatabase();
  await seedTwoTenants(testDb.ownerUrl);
  owner = postgres(testDb.ownerUrl, { max: 2, onnotice: () => undefined });
  dispatcher = createOutboxDispatcherDatabase({ url: testDb.dispatcherUrl });
  redis = new Redis(REDIS_URL, { maxRetriesPerRequest: 1 });
  queue = new Queue(commissionStatementReminderQueue, {
    connection: redis.duplicate({ maxRetriesPerRequest: null }),
    prefix: PREFIX,
  });
  schedule = createCommissionReminderSchedule({
    redisUrl: REDIS_URL,
    logger: silent,
    prefix: PREFIX,
  });
});

afterAll(async () => {
  const results = await Promise.allSettled([
    queue?.close(),
    schedule?.close(),
    dispatcher?.close(),
    owner?.end(),
  ]);
  redis?.disconnect();
  await testDb?.drop();
  const failed = results.find(
    (result): result is PromiseRejectedResult => result.status === 'rejected',
  );
  if (failed !== undefined) throw failed.reason;
});

/** يمسح مفاتيح الاستعادة الثلاثة وجدولات البادئة الخاصة بالاختبار فقط. */
async function resetRedis(): Promise<void> {
  const keys = await redis.keys(`${PREFIX}:*`);
  await redis.del(
    REMINDER_RECOVERY_KEY,
    REMINDER_SENTINEL_KEY,
    REMINDER_RECOVERY_SLOT_KEY,
    ...keys,
  );
}

beforeEach(async () => {
  await resetRedis();
  await owner`DELETE FROM operational_recovery_flags`;
  await owner`DELETE FROM outbox WHERE event_type = 'CompanyCreated'`;
});

afterEach(resetRedis);

/** اعتماديات الاستعادة الحقيقية لنشر الشهادة قبل الفحص الدوري. */
function recoveryDeps(): RecoverCommissionRemindersDeps {
  return {
    database: reminderRecoveryReaders(dispatcher),
    store: createReminderRecoveryStore(redis),
    schedule,
    ids,
    clock: { now: () => new Date() },
    logger: silent,
    release: 'integration',
    clearIncident: (input) =>
      dispatcher.clearReminderSchedulesLostFlag({
        flagId: input.incidentId,
        rebuiltRunId: input.runId,
        rebuiltPassId: input.passId,
        companiesRebuilt: input.companiesRebuilt,
        auditId: input.auditId,
      }),
  };
}

const ready = () =>
  checkCommissionReminderReadiness({
    database: reminderRecoveryReaders(dispatcher),
    store: createReminderRecoveryStore(redis),
    schedule,
  });

/** يبني المشغّل على Redis وPostgreSQL الحقيقيين، مع تسجيل مراقَب بدل الصامت. */
function sweeperWith(register: typeof schedule.register, logger = silent) {
  return createCommissionReminderCoverageSweeper({
    database: reminderRecoveryReaders(dispatcher),
    store: createReminderRecoveryStore(redis),
    schedule: { existsAll: schedule.existsAll, register },
    clock: { now: () => new Date() },
    logger,
  });
}

it('#1220: a quiet company whose scheduler vanished is restored while the sentinel and run_id survive', async () => {
  expect((await recoverCommissionReminders(recoveryDeps(), { mode: 'STARTUP' })).outcome).toBe(
    'PUBLISHED',
  );
  const sentinelBefore = await redis.get(REMINDER_SENTINEL_KEY);
  await queue.removeJobScheduler(commissionStatementReminderSchedulerId(A.company));
  expect(await schedule.existsAll([A.company, B.company])).toEqual([false, true]);
  // الاستعادة العادية ما بتشوفش الحالة دي: الشهادة سليمة وفي نفس تشغيل Redis ومفيش علم ولا حدث موقوف.
  expect((await recoverCommissionReminders(recoveryDeps(), { mode: 'DETECT' })).outcome).toBe(
    'NOTHING_NEEDED',
  );
  const register = vi.fn(schedule.register);
  const warn = vi.fn();
  const logger = { ...silent, warn } as unknown as typeof silent;

  const result = await sweeperWith(register, logger).run();

  expect(result).toMatchObject({ outcome: 'COMPLETED', missing: 1, restored: 1 });
  expect(register).toHaveBeenCalledTimes(1);
  expect(register).toHaveBeenCalledWith(A.company);
  expect(await schedule.existsAll([A.company, B.company])).toEqual([true, true]);
  expect(warn).toHaveBeenCalledWith(
    expect.objectContaining({
      code: COMMISSION_REMINDER_ALERT_SCHEDULER_RESTORED,
      missing: 1,
      restored: 1,
      failed: 0,
    }),
    expect.any(String),
  );
  expect(await redis.get(REMINDER_SENTINEL_KEY)).toBe(sentinelBefore);
  expect(await ready()).toEqual({ ready: true, reason: null });
  expect(
    await owner`SELECT id FROM operational_recovery_flags WHERE cleared_at IS NULL`,
  ).toHaveLength(0);
});

it('#1220: a healthy sweep registers nothing and logs nothing', async () => {
  await recoverCommissionReminders(recoveryDeps(), { mode: 'STARTUP' });
  const register = vi.fn(schedule.register);
  const warn = vi.fn();

  const result = await sweeperWith(register, { ...silent, warn } as unknown as typeof silent).run();

  expect(result).toMatchObject({ outcome: 'COMPLETED', missing: 0, restored: 0 });
  expect(register).not.toHaveBeenCalled();
  expect(warn).not.toHaveBeenCalled();
});

it('#1220: with no certificate the sweep leaves the loss to the recovery pass', async () => {
  const register = vi.fn(schedule.register);

  const result = await sweeperWith(register).run();

  expect(result).toMatchObject({ outcome: 'SKIPPED', skipReason: 'CERTIFICATE_NOT_HEALTHY' });
  expect(register).not.toHaveBeenCalled();
  expect(await schedule.existsAll([A.company, B.company])).toEqual([false, false]);
});
