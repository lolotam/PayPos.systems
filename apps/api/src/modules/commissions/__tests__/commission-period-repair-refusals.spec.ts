import { afterEach, beforeEach, expect, it } from 'vitest';

import {
  approvedDeviceToken,
  ids,
  memberWithoutPlanPermission,
} from './commission-plan-versions.fixture.ts';
import {
  blockRows,
  correctionRows,
  flatPlan,
  NO_PLAN_REPAIR,
  repairFixture,
  repairWrites,
  seedBlockedSeptember,
  type RepairFixture,
} from './commission-period-repair.fixture.ts';

let r: RepairFixture;
let rollover = false;
let reads = 0;
// في وضع الانقلاب: أول قراءة للشهر الحالي في 30 أكتوبر، وكل قراءة بعدها في 2 نوفمبر (الشهر اتغيّر أثناء انتظار الأقفال).
const clock = () =>
  new Date(rollover && ++reads > 1 ? '2026-11-02T12:00:00.000Z' : '2026-10-30T12:00:00.000Z');
const L1 = ids.newId();
const body = { period: '2026-09', plan: NO_PLAN_REPAIR };
const seed = (code?: 'NO_PLAN' | 'NO_SALARY') =>
  seedBlockedSeptember(r, {
    plan: flatPlan(1000),
    planFrom: '2026-09-15',
    lines: [{ id: L1, date: '2026-09-10', net: '200.000' }],
    frozen: [],
    ...(code === undefined ? {} : { code }),
  });

beforeEach(async () => {
  rollover = false;
  reads = 0;
  r = await repairFixture(clock);
});
afterEach(async () => {
  await r.db.close();
  await r.h.close();
});

const refused = (response: { status: number; body: Record<string, unknown> }) => [
  response.status,
  response.body['code'],
];

it('CM-52 with no blocked correction at all the repair is 422 COMMISSION_REPAIR_NOT_ALLOWED and writes nothing', async () => {
  const before = await repairWrites(r);

  const response = await r.repair(body, 'no-block');

  expect(refused(response)).toEqual([422, 'COMMISSION_REPAIR_NOT_ALLOWED']);
  expect(await repairWrites(r)).toEqual(before);
});

it('CM-52c: a NO_SALARY block is refused with 422 and the version, audit, corrections and event stay unwritten (the NO_PLAN turn and the repair itself are proved through the real flow in commission-period-repair-flow.spec.ts)', async () => {
  const seeded = await seed('NO_SALARY');
  const before = await repairWrites(r);

  const refusedBlock = await r.repair(body, 'cm-52c-no-salary');

  expect(refused(refusedBlock)).toEqual([422, 'COMMISSION_REPAIR_NOT_ALLOWED']);
  expect(await repairWrites(r)).toEqual(before);
  expect(await blockRows(r)).toEqual([
    expect.objectContaining({ id: seeded.blockId, code: 'NO_SALARY', resolved: false }),
  ]);
});

it('CM-52 a resolved block is refused: a second repair of the same month is 422', async () => {
  await seed();
  const first = await r.repair(body, 'resolved-first');

  const second = await r.repair(body, 'resolved-second');

  expect(first.status).toBe(201);
  expect(refused(second)).toEqual([422, 'COMMISSION_REPAIR_NOT_ALLOWED']);
  expect(await repairWrites(r)).toEqual([1, 1, 1, 1]);
});

it('an invalid plan is 422 COMMISSION_PLAN_INVALID with the engine code and no writes', async () => {
  await seed();
  const before = await repairWrites(r);
  const invalid = {
    ...NO_PLAN_REPAIR,
    tiers: { enabled: true, mode: 'MARGINAL', accumulator: 'AMOUNT', steps: [] },
  };

  const response = await r.repair({ period: '2026-09', plan: invalid }, 'invalid-plan');

  expect(refused(response)).toEqual([422, 'COMMISSION_PLAN_INVALID']);
  expect(response.body['details']).toEqual({ code: 'NO_STEPS' });
  expect(await repairWrites(r)).toEqual(before);
});

it('without the plan permission and with the feature off the repair is the uniform refusal and nothing is written', async () => {
  await seed();
  const before = await repairWrites(r);
  const member = await memberWithoutPlanPermission(r);

  const noPermission = await r.repair(body, 'no-permission', r.employee, member.cookie);
  await r.h.owner`INSERT INTO company_feature_overrides(company_id,flag,enabled,reason,set_by)
    VALUES (${r.company},'commissions',false,'repair proof',${r.userId})`;
  const featureOff = await r.repair(body, 'feature-off');

  expect(refused(noPermission)).toEqual([403, 'FORBIDDEN']);
  expect(refused(featureOff)).toEqual([403, 'FEATURE_DISABLED']);
  expect(await repairWrites(r)).toEqual(before);
});

// الإقران بالجهاز بيمرّ على Redis؛ بيتثبّت في شاردات الـ API في CI مع باقي اختبارات الأجهزة.
it('a real device principal is refused even with a valid body and key, and nothing is written', async () => {
  await seed();
  const before = await repairWrites(r);
  const token = await approvedDeviceToken(r);

  const device = await r.h.app.inject({
    method: 'POST',
    url: r.path(),
    headers: {
      authorization: `Device ${token}`,
      'x-company-id': r.company,
      'idempotency-key': 'device',
    },
    payload: body,
  });

  expect([device.statusCode, (device.json() as { code: string }).code]).toEqual([403, 'FORBIDDEN']);
  expect(await repairWrites(r)).toEqual(before);
});

it('another company cannot repair this business: the uniform 403, no writes, and the block stays open', async () => {
  const seeded = await seed();
  const before = await repairWrites(r);
  const strangerCookie = await r.h.signedInOperator('repair-stranger@example.test');
  await r.h.onboard(strangerCookie, 'Repair stranger employer');

  const response = await r.repair(body, 'cross-tenant', r.employee, strangerCookie);

  expect(refused(response)).toEqual([403, 'FORBIDDEN']);
  expect(await repairWrites(r)).toEqual(before);
  expect(await blockRows(r)).toEqual([
    expect.objectContaining({ id: seeded.blockId, resolved: false }),
  ]);
});

it.each(['0001-01', '2025-12', '2026-10'])(
  'a month outside the life of the business or not yet closed (%s) is refused before any lock: no statement rows are created',
  async (period) => {
    await seed();
    const statements = () => r.h.owner`SELECT period FROM commission_statements ORDER BY period`;
    const before = await statements();

    const response = await r.repair({ ...body, period }, `outside-${period}`);

    expect(refused(response)).toEqual([422, 'COMMISSION_REPAIR_NOT_ALLOWED']);
    expect(await statements()).toEqual(before);
  },
);

it('the same key and body replays the stored answer and writes nothing more; the same key with another body is IDEMPOTENCY_KEY_REUSED', async () => {
  await seed();
  const first = await r.repair(body, 'replay-key');
  const afterFirst = await repairWrites(r);

  const replay = await r.repair(body, 'replay-key');
  const other = await r.repair({ ...body, period: '2026-08' }, 'replay-key');

  expect(replay.status).toBe(201);
  expect(replay.body).toEqual(first.body);
  expect(refused(other)).toEqual([422, 'IDEMPOTENCY_KEY_REUSED']);
  expect(await repairWrites(r)).toEqual(afterFirst);
});

it('a change of the business month while waiting for the locks is 409 TRANSACTION_RETRY_REQUIRED with one lock call and no writes', async () => {
  await seed();
  const before = await repairWrites(r);
  const statements = () => r.h.owner`SELECT period FROM commission_statements ORDER BY period`;
  const periodsBefore = await statements();
  rollover = true;

  const response = await r.repair(body, 'rollover');

  expect(refused(response)).toEqual([409, 'TRANSACTION_RETRY_REQUIRED']);
  expect(await repairWrites(r)).toEqual(before);
  expect(await correctionRows(r)).toEqual([]);
  // نداء قفل واحد بس لسبتمبر وأكتوبر: نوفمبر ما اتقفلش ولا اتعمل كشفه.
  expect(await statements()).toEqual(periodsBefore);
});
