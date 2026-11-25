import {
  createDatabase,
  createOutboxDispatcherDatabase,
  SYSTEM_ROLES,
  type ClaimedEvent,
  type Database,
  type DeliveryOutcome,
  type OutboxDispatcherDatabase,
} from '@pospay/db';
import { systemUuidV7 } from '@pospay/ids';
import { createLogger } from '@pospay/observability';
import { Redis } from 'ioredis';
import postgres from 'postgres';
import { afterAll, afterEach, beforeAll, beforeEach, expect, it } from 'vitest';

import { seedTwoTenants, TENANT } from '../../../../packages/db/test/tenancy-fixtures.ts';
import {
  createTestDatabase,
  type TestDatabase,
} from '../../../../packages/db/test/test-database.ts';
import {
  checkRecoveryPrerequisites,
  RECOVERY_FUNCTION_MISSING,
} from '../commission-reminder-operator.ts';
import {
  checkCommissionReminderReadiness,
  createCommissionReminderDelivery,
  createCommissionReminderSchedule,
  createCommissionReminderScheduleConsumer,
  createReminderRecoveryStore,
  createStatementReminderTransactions,
  recoverCommissionReminders,
  remindCommissionStatements,
  reminderRecoveryReaders,
  REMINDER_RECOVERY_KEY,
  REMINDER_RECOVERY_SLOT_KEY,
  REMINDER_SENTINEL_KEY,
  type RecoverCommissionRemindersDeps,
} from '../modules/commissions/index.ts';
import { statementReminderAlertRules } from '../modules/commissions/persistence/alert-rule.adapter.ts';
import {
  commissionStatementRecipients,
  readExplicitCompanyFeature,
} from '../modules/identity/index.ts';
import { companyBusinesses, companyFeatureEnabled } from '../modules/tenancy/index.ts';
import { createDeliverer } from '../outbox/deliver.ts';

// Redis حقيقي، ومفاتيح BullMQ على بادئة خاصة بالاختبار؛ مفاتيح الاستعادة الثلاثة بنمسحها بالاسم
// بس (بدون أي FLUSH) عشان نفس Redis يخدم أي اختبار تاني.
const REDIS_URL =
  process.env['COMMISSION_REMINDER_TEST_REDIS_URL'] ||
  process.env['REDIS_URL'] ||
  `redis://:${process.env['REDIS_PASSWORD'] || 'pospay_dev_redis'}@127.0.0.1:6379`;
const PREFIX = `test-reminders-${Math.random().toString(16).slice(2, 10)}`;
const A = TENANT.A;
const B = TENANT.B;
const ids = systemUuidV7();
const logger = createLogger('silent');

let testDb: TestDatabase;
let owner: postgres.Sql;
let app: Database;
let dispatcher: OutboxDispatcherDatabase;
let redis: Redis;
let schedule: ReturnType<typeof createCommissionReminderSchedule>;

beforeAll(async () => {
  testDb = await createTestDatabase();
  await seedTwoTenants(testDb.ownerUrl);
  owner = postgres(testDb.ownerUrl, { max: 2, onnotice: () => undefined });
  app = createDatabase({ url: testDb.appUrl, ids, maxConnections: 2 });
  dispatcher = createOutboxDispatcherDatabase({ url: testDb.dispatcherUrl });
  redis = new Redis(REDIS_URL, { maxRetriesPerRequest: 1 });
  schedule = createCommissionReminderSchedule({ redisUrl: REDIS_URL, logger, prefix: PREFIX });
});

afterAll(async () => {
  const results = await Promise.allSettled([
    schedule?.close(),
    dispatcher?.close(),
    app?.close(),
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
  await owner`DELETE FROM consumed_events WHERE consumer_id = 'commissions.reminder-schedule'`;
});

afterEach(resetRedis);

/** اعتماديات الاستعادة الحقيقية: Redis وPostgreSQL على أدوارهم، والمسح بدالة الـdefiner. */
function recoveryDeps(): RecoverCommissionRemindersDeps {
  return {
    database: reminderRecoveryReaders(dispatcher),
    store: createReminderRecoveryStore(redis),
    schedule,
    ids,
    clock: { now: () => new Date() },
    logger,
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

const openFlags = () =>
  owner`SELECT id, code FROM operational_recovery_flags WHERE cleared_at IS NULL`;

const closedFlags = () =>
  owner`SELECT id FROM operational_recovery_flags WHERE cleared_at IS NOT NULL`;

const companyCreated = (companyId: string): ClaimedEvent => ({
  id: ids.newId(),
  companyId,
  aggregateType: 'company',
  aggregateId: companyId,
  eventType: 'CompanyCreated',
  payload: {},
  attempt: 1,
});

/** مسار التسليم الحقيقي: التسجيل في Redis قبل علامة الاستهلاك ومستهلك العلامة المسجّل. */
function delivery(register: typeof schedule.register = schedule.register) {
  const deliverer = createDeliverer(app, [createCommissionReminderScheduleConsumer()], logger, {
    knownEventTypes: ['CompanyCreated'],
  });
  const wrapped = createCommissionReminderDelivery<ClaimedEvent, DeliveryOutcome>(
    { ...schedule, register },
    logger,
  );
  return (event: ClaimedEvent) => wrapped(event, deliverer);
}

const marks = (eventId: string) =>
  owner`SELECT 1 FROM consumed_events
    WHERE consumer_id = 'commissions.reminder-schedule' AND event_id = ${eventId}`;

it('CM-57b: CompanyCreated registers the scheduler before the consumed mark', async () => {
  const event = companyCreated(A.company);
  expect(await delivery()(event)).toEqual({ delivered: true });

  expect(await schedule.exists(A.company)).toBe(true);
  expect(await marks(event.id)).toHaveLength(1);
});

it('CM-57b: a Redis failure is a retryable failure with no consumed mark', async () => {
  const event = companyCreated(A.company);
  const failing = async () => ({ registered: false, error: 'REDIS_DOWN' });
  const outcome = await delivery(failing)(event);

  expect(outcome).toMatchObject({ delivered: false, error: 'REDIS_DOWN' });
  expect(await marks(event.id)).toHaveLength(0);
  expect(await schedule.exists(A.company)).toBe(false);
  expect(await delivery()(event)).toEqual({ delivered: true });
  expect(await marks(event.id)).toHaveLength(1);
});

it('CM-57: the first start-up on an empty Redis rebuilds every company and turns /ready healthy', async () => {
  const result = await recoverCommissionReminders(recoveryDeps(), { mode: 'STARTUP' });

  expect(result.outcome).toBe('PUBLISHED');
  expect(await schedule.existsAll([A.company, B.company])).toEqual([true, true]);
  expect(await openFlags()).toHaveLength(0);
  expect(await closedFlags()).toHaveLength(1);
  expect(await ready()).toEqual({ ready: true, reason: null });
});

it('CM-57c: a lost Redis is detected and every quiet company is rebuilt', async () => {
  await recoverCommissionReminders(recoveryDeps(), { mode: 'STARTUP' });
  await resetRedis();
  expect((await ready()).ready).toBe(false);
  const result = await recoverCommissionReminders(recoveryDeps(), { mode: 'DETECT' });

  expect(result.outcome).toBe('PUBLISHED');
  expect(await schedule.existsAll([A.company, B.company])).toEqual([true, true]);
  expect(await ready()).toEqual({ ready: true, reason: null });
});

/** يوقف حدث `CompanyCreated` بعد عتبة الشهادة الحالية بجدولة ناقصة أو موجودة. */
async function parkCompanyCreated(companyId: string): Promise<void> {
  await owner`INSERT INTO outbox (company_id, id, aggregate_type, aggregate_id, event_type, payload,
                                  attempts, next_attempt_at, last_error, parked_at)
    VALUES (${companyId}, ${ids.newId()}, 'company', ${companyId}, 'CompanyCreated', '{}',
            10, clock_timestamp() + interval '1 day', 'TypeError', clock_timestamp())`;
}

it('a parked CompanyCreated whose scheduler is missing degrades /ready and starts a pass', async () => {
  await recoverCommissionReminders(recoveryDeps(), { mode: 'STARTUP' });
  await parkCompanyCreated(A.company);
  await redis.del(...(await redis.keys(`${PREFIX}:*${A.company}*`)));

  expect((await ready()).reason).toBe('SCHEDULER_MISSING');
  const result = await recoverCommissionReminders(recoveryDeps(), { mode: 'DETECT' });
  expect(result.outcome).toBe('PUBLISHED');
  expect(await schedule.exists(A.company)).toBe(true);
});

it('a parked CompanyCreated whose scheduler exists neither degrades /ready nor starts a pass', async () => {
  await recoverCommissionReminders(recoveryDeps(), { mode: 'STARTUP' });
  await parkCompanyCreated(A.company);

  expect(await ready()).toEqual({ ready: true, reason: null });
  const result = await recoverCommissionReminders(recoveryDeps(), { mode: 'DETECT' });
  expect(result.outcome).toBe('NOTHING_NEEDED');
});

/** مالك الشركة الأساسي: بيستلم الإشعارين حتى لو نشاطه هادي. */
async function seedOwner(): Promise<string> {
  const userId = ids.newId();
  const roleId = SYSTEM_ROLES.find((role) => role.code === 'owner')?.id ?? '';
  await owner`INSERT INTO "user"(id,name,email) VALUES(${userId},'owner',${`${userId}@example.test`})`;
  await owner`INSERT INTO memberships(company_id,id,user_id,role_id,role_owner_key,scope_type,scope_id,starts_at)
    VALUES(${A.company},${ids.newId()},${userId},${roleId},'global','COMPANY',${A.company},'2026-01-01T00:00:00Z')`;
  return userId;
}

it('CM-57c: a quiet business gets its DRAFT statement and the reminder after a Redis loss', async () => {
  await owner`INSERT INTO company_feature_overrides (company_id, flag, enabled, reason, set_by)
    VALUES (${A.company}, 'commissions', true, 'fixture', (SELECT owner_user_id FROM companies WHERE id = ${A.company}))`;
  await seedOwner();
  const transactions = createStatementReminderTransactions(app, ids, {
    businesses: companyBusinesses,
    feature: (tx, id) => companyFeatureEnabled(tx, id, 'commissions'),
    recipients: commissionStatementRecipients,
    alertRules: statementReminderAlertRules,
    switch: readExplicitCompanyFeature,
  });
  const clock = { now: () => new Date('2026-11-03T06:00:00Z') };
  await recoverCommissionReminders(recoveryDeps(), { mode: 'STARTUP' });
  await resetRedis();
  await recoverCommissionReminders(recoveryDeps(), { mode: 'DETECT' });
  expect(await schedule.exists(A.company)).toBe(true);

  const result = await remindCommissionStatements({ transactions, clock }, A.company);

  expect(result.reminders).toBeGreaterThan(0);
  const statements = await owner`SELECT status FROM commission_statements
    WHERE company_id = ${A.company} AND period = '2026-10'`;
  expect(statements).toEqual([{ status: 'DRAFT' }]);
  const ledger = await owner`SELECT kind FROM commission_statement_reminders
    WHERE company_id = ${A.company} ORDER BY kind`;
  expect(ledger.length).toBe(result.reminders);
});

it('#1222 item 8 / P3-1: operator prerequisites pass live and reject missing dispatcher EXECUTE without running probe', async () => {
  const ownerQuery = async (text: string) =>
    (await owner.unsafe(text)) as readonly Record<string, unknown>[];
  expect(
    await checkRecoveryPrerequisites(ownerQuery, () => dispatcher.companyIdPage(null, 1)),
  ).toBeNull();

  await owner`REVOKE EXECUTE ON FUNCTION public.recovery_company_ids(uuid, integer) FROM pospay_dispatcher`;
  try {
    let probed = false;
    const code = await checkRecoveryPrerequisites(ownerQuery, async () => {
      probed = true;
      return dispatcher.companyIdPage(null, 1);
    });
    expect(code).toBe(RECOVERY_FUNCTION_MISSING);
    expect(probed).toBe(false);
  } finally {
    await owner`GRANT EXECUTE ON FUNCTION public.recovery_company_ids(uuid, integer) TO pospay_dispatcher`;
  }
});
