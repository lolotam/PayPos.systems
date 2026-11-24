import {
  CommissionBlockNoticesMissingError,
  createCommissionCorrectionScope,
  postCommissionCorrections,
  selectCommissionCorrectionTargets,
} from '@pospay/commissions-posting';
import { lockStatementPeriods } from '@pospay/db';
import { afterEach, beforeEach, expect, it } from 'vitest';

import { insertCommissionLineProjection } from '../../../../../../packages/db/test/commission-line-fixtures.ts';
import { payApprovedStatement } from '../../../../../../packages/db/test/commission-statement-fixtures.ts';
import { insertTipSalary } from '../../../../../../packages/db/test/commission-tip-salary-fixtures.ts';
import { createCommissionPeriodRepairScope } from '../persistence/commission-period-repair-scope.ts';
import { repairCommissionPeriod } from '../use-cases/repair-commission-period/repair-commission-period.usecase.ts';
import {
  COMMISSION_NOW,
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
  salaryPlan,
  seedBlockedSeptember,
  type RepairFixture,
} from './commission-period-repair.fixture.ts';

let r: RepairFixture;
beforeEach(async () => {
  r = await repairFixture();
});
afterEach(async () => {
  await r.db.close();
  await r.h.close();
});

const LA = ids.newId();
const LB = ids.newId();
const body = { period: '2026-09', plan: NO_PLAN_REPAIR };

const events = () => r.h.owner`SELECT aggregate_type, aggregate_id::text AS aggregate_id,
  event_type, payload FROM outbox WHERE event_type='CommissionPeriodRepairSaved'`;

const seedFlat = (lines: { id: string; date: string; net: string }[] = []) =>
  seedBlockedSeptember(r, {
    plan: flatPlan(1000),
    planFrom: '2026-09-15',
    lines,
    frozen: [],
  });

/** يشغّل خطوة التصحيح المشتركة كما بيشغّلها الـ worker لحدث متأخر جديد: كل شهر مقفول لحد الشهر الحالي. */
async function lateEventStep(): Promise<void> {
  await r.db.withTenant(r.company, async (tx) => {
    const locked = await lockStatementPeriods(tx, {
      businessId: r.business,
      periods: ['2026-09', '2026-10'],
      ids,
    });
    await postCommissionCorrections({
      scope: createCommissionCorrectionScope(tx, ids, { now: () => COMMISSION_NOW }),
      businessId: r.business,
      companyId: r.company,
      eventId: ids.newId(),
      targets: selectCommissionCorrectionTargets(locked, ['2026-09'], '2026-10'),
      employees: [{ period: '2026-09', employeeId: r.employee }],
    });
  });
}

it('CM-52c O4 through the real flow: a late line turns the block NO_SALARY into NO_PLAN, the salary keeps it, and the repair then posts +10.000 and +40.000 on the same block', async () => {
  const seeded = await seedBlockedSeptember(r, {
    plan: salaryPlan,
    planFrom: '2026-09-15',
    lines: [{ id: LA, date: '2026-09-20', net: '700.000' }],
    frozen: [],
    code: 'NO_SALARY',
  });
  const refusedWhileNoSalary = await r.repair(body, 'o4-no-salary');
  await r.db.withTenant(r.company, (tx) =>
    insertCommissionLineProjection(tx, r.tenant, ids, {
      lineId: LB,
      businessDate: '2026-09-10',
      occurredAt: '2026-09-10T09:00:00Z',
      recordedAt: '2026-10-02T09:00:00Z',
      period: '2026-09',
      net: '200.000',
      ruleKind: 'FOLLOW_PLAN',
      sessionId: ids.newId(),
      revision: 1,
    }),
  );

  await lateEventStep();
  const afterLateLine = await blockRows(r);
  await r.db.withTenant(r.company, (tx) =>
    insertTipSalary(tx, 'commission_salaries', r.tenant, {
      effectiveFrom: '2026-09-01',
      amount: '500.000',
    }),
  );
  await lateEventStep();
  const afterSalary = await blockRows(r);
  const response = await r.repair(body, 'o4-repair');

  expect(refusedWhileNoSalary.status).toBe(422);
  expect(afterLateLine).toEqual([
    expect.objectContaining({ id: seeded.blockId, code: 'NO_PLAN', resolved: false }),
  ]);
  expect(afterSalary).toEqual([
    expect.objectContaining({ id: seeded.blockId, code: 'NO_PLAN', resolved: false }),
  ]);
  expect(response.status).toBe(201);
  expect(response.body['blocked_correction']).toEqual({
    id: seeded.blockId,
    code: 'NO_PLAN',
    resolved: true,
  });
  const rows = await correctionRows(r);
  expect(rows).toHaveLength(2);
  expect(Object.fromEntries(rows.map((row) => [row['source_ref'], row['amount']]))).toEqual({
    [`line:${LB}`]: '10.000',
    [`line:${LA}`]: '40.000',
  });
  expect(rows.every((row) => row['event_id'] === seeded.firstEventId)).toBe(true);
  expect(await blockRows(r)).toEqual([
    expect.objectContaining({ id: seeded.blockId, resolved: true }),
  ]);
});

it('appends exactly one CommissionPeriodRepairSaved with ids and the outcome only, and a replay of the same key appends no second one', async () => {
  const seeded = await seedFlat([{ id: LB, date: '2026-09-10', net: '200.000' }]);

  const first = await r.repair(body, 'event-key');
  const replay = await r.repair(body, 'event-key');

  expect(first.status).toBe(201);
  expect(replay.body).toEqual(first.body);
  const version = first.body['version'] as { id: string };
  expect(await events()).toEqual([
    {
      aggregate_type: 'commission_plan_version',
      aggregate_id: version.id,
      event_type: 'CommissionPeriodRepairSaved',
      payload: {
        business_id: r.business,
        employee_id: r.employee,
        period: '2026-09',
        version_id: version.id,
        blocked_correction_id: seeded.blockId,
        resolved: true,
      },
    },
  ]);
});

it('CM-52b: the event is emitted when the block stays NO_SALARY, saying the repair was saved and the block still open', async () => {
  await seedBlockedSeptember(r, {
    plan: salaryPlan,
    planFrom: '2026-09-15',
    lines: [
      { id: LB, date: '2026-09-10', net: '200.000' },
      { id: LA, date: '2026-09-20', net: '700.000' },
    ],
    frozen: [],
  });

  const response = await r.repair(body, 'event-no-salary');

  expect(response.status).toBe(201);
  expect(await correctionRows(r)).toEqual([]);
  expect(await events()).toEqual([
    expect.objectContaining({ payload: expect.objectContaining({ resolved: false }) }),
  ]);
});

it('a failing event append rolls back the version, the corrections, the block update and the audit', async () => {
  await seedFlat([{ id: LB, date: '2026-09-10', net: '200.000' }]);
  const before = await repairWrites(r);
  await r.h.owner.unsafe(`CREATE FUNCTION fail_repair_event() RETURNS trigger LANGUAGE plpgsql AS
    $$ BEGIN RAISE EXCEPTION 'repair event refused'; END $$`);
  await r.h.owner.unsafe(`CREATE TRIGGER fail_repair_event BEFORE INSERT ON outbox
    FOR EACH ROW WHEN (NEW.event_type = 'CommissionPeriodRepairSaved')
    EXECUTE FUNCTION fail_repair_event()`);

  const response = await r.repair(body, 'event-fails');

  expect(response.status).toBe(500);
  expect(await repairWrites(r)).toEqual(before);
  expect(await correctionRows(r)).toEqual([]);
  expect(await blockRows(r)).toEqual([
    expect.objectContaining({ code: 'NO_PLAN', resolved: false }),
  ]);
  expect(await events()).toEqual([]);
});

it('a repair that prices a real line to the amount already frozen (zero difference) resolves the block, posts nothing and emits the event', async () => {
  // السطر بعد بداية الخطة العادية: بيتسعّر 10% = 30.000 زي المجمّد بالظبط، فخطة الإصلاح ما بتغيّرش حاجة.
  const seeded = await seedBlockedSeptember(r, {
    plan: flatPlan(1000),
    planFrom: '2026-09-15',
    lines: [{ id: LB, date: '2026-09-20', net: '300.000' }],
    frozen: [{ id: LB, date: '2026-09-20', amount: '30.000' }],
  });

  const response = await r.repair(body, 'zero-difference');

  expect(response.status).toBe(201);
  expect(response.body['blocked_correction']).toEqual({
    id: seeded.blockId,
    code: 'NO_PLAN',
    resolved: true,
  });
  expect(await correctionRows(r)).toEqual([]);
  expect(await events()).toHaveLength(1);
});

it('a PAID source month is repaired like an APPROVED one: the correction lands in the DRAFT month', async () => {
  const seeded = await seedFlat([{ id: LB, date: '2026-09-10', net: '200.000' }]);
  const [september] = await r.h.owner`SELECT id FROM commission_statements
    WHERE company_id=${r.company} AND period='2026-09'`;
  await r.db.withTenant(r.company, (tx) =>
    payApprovedStatement(tx, r.tenant, september?.['id'] as string, ids),
  );

  const response = await r.repair(body, 'paid-source');

  expect(response.status).toBe(201);
  expect(await correctionRows(r)).toEqual([
    expect.objectContaining({
      source_ref: `line:${LB}`,
      amount: '10.000',
      target_period: '2026-10',
      target_statement_id: seeded.targetStatementId,
    }),
  ]);
});

// حدّ الاختبار ده: Promise.all ما بيثبتش إن الطلبين اتقابلوا عند الـ claim؛ مسار الانتظار والـ replay مثبت في commission-period-repair-isolation.spec.ts.
it('two concurrent requests with one key write once: one answers 201 and the other replays it or reports the key busy', async () => {
  await seedFlat([{ id: LB, date: '2026-09-10', net: '200.000' }]);

  const [a, b] = await Promise.all([
    r.repair(body, 'concurrent-key'),
    r.repair(body, 'concurrent-key'),
  ]);

  const outcomes = [a, b].map((response) => [response.status, response.body['code']]);
  expect(outcomes.some(([status]) => status === 201)).toBe(true);
  for (const [status, code] of outcomes) {
    expect(status === 201 || (status === 409 && code === 'IDEMPOTENCY_KEY_IN_PROGRESS')).toBe(true);
  }
  expect(await repairWrites(r)).toEqual([1, 1, 1, 1]);
  expect(await events()).toHaveLength(1);
});

it('the feature switched off after a successful repair refuses the stored replay before any answer is returned', async () => {
  await seedFlat([{ id: LB, date: '2026-09-10', net: '200.000' }]);
  const first = await r.repair(body, 'replay-after-revoke');
  await r.h.owner`INSERT INTO company_feature_overrides(company_id,flag,enabled,reason,set_by)
    VALUES (${r.company},'commissions',false,'revoked before replay',${r.userId})`;

  const replay = await r.repair(body, 'replay-after-revoke');

  expect(first.status).toBe(201);
  expect([replay.status, replay.body['code']]).toEqual([403, 'FEATURE_DISABLED']);
  expect(replay.body['version']).toBeUndefined();
});

it('the notice-invariant failure leaves the transaction and rolls the version back for real, so the route would answer 500 with nothing written', async () => {
  await seedFlat([{ id: LB, date: '2026-09-10', net: '200.000' }]);
  const before = await repairWrites(r);
  const readers = {
    employeeLock: async () => true,
    businessCalendar: async () => ({ timeZone: 'Asia/Kuwait', createdAt: new Date('2026-01-01') }),
    access: async () => null,
  };
  const actor = {
    companyId: r.company,
    userId: r.userId,
    businessId: r.business,
    employeeId: r.employee,
  };
  const command = { ...actor, key: 'invariant', fingerprint: 'f'.repeat(64), input: body };

  const failure = await r.db
    .withTenant(r.company, async (tx) => {
      const scope = createCommissionPeriodRepairScope(tx, actor, ids, readers, {
        now: () => COMMISSION_NOW,
      });
      const real = scope.corrections();
      // الإسقاط من غير نسخ خطط والصف المفتوح متخفّي: الحساب يفشل بـ NO_PLAN والخطوة تحاول تسجّل توقفاً جديداً من غير
      // منفذ جرس، وهي الحالة المستحيلة اللي لازم تطلع من المعاملة.
      return repairCommissionPeriod(
        {
          ...scope,
          corrections: () => ({
            ...real,
            readOpenBlock: async () => null,
            readMonthProjection: async (input) => ({
              ...(await real.readMonthProjection(input)),
              versions: [],
            }),
          }),
        },
        command,
        ids,
        { now: () => COMMISSION_NOW },
      );
    })
    .catch((error: unknown) => error);

  expect(failure).toBeInstanceOf(CommissionBlockNoticesMissingError);
  expect(await repairWrites(r)).toEqual(before);
  expect(await events()).toEqual([]);
});

it('a repair version never prices another month: an October line is estimated by the ordinary plan at 10%, not by the 5% repair', async () => {
  await seedFlat([{ id: LB, date: '2026-09-10', net: '200.000' }]);
  const repaired = await r.repair(body, 'other-month');
  const OCTOBER_LINE = ids.newId();
  await r.db.withTenant(r.company, (tx) =>
    insertCommissionLineProjection(tx, r.tenant, ids, {
      lineId: OCTOBER_LINE,
      businessDate: '2026-10-05',
      occurredAt: '2026-10-05T09:00:00Z',
      recordedAt: '2026-10-05T09:00:00Z',
      period: '2026-10',
      net: '200.000',
      ruleKind: 'FOLLOW_PLAN',
      sessionId: ids.newId(),
    }),
  );

  const estimate = await r.h.send(
    'GET',
    `/v1/businesses/${r.business}/commissions/periods/2026-10/estimate`,
    { cookie: r.cookie, company: r.company },
  );

  expect(repaired.status).toBe(201);
  expect(estimate.status).toBe(200);
  const employees = estimate.body['employees'] as {
    employee_id: string;
    sources: { source_ref: string; amount: string }[];
  }[];
  const source = employees
    .find((employee) => employee.employee_id === r.employee)
    ?.sources.find((row) => row.source_ref === `line:${OCTOBER_LINE}`);
  expect(source?.amount).toBe('20.000');
});

it('a member granted the plan permission repairs once; after the grant is revoked the stored replay is refused before any body is returned', async () => {
  await seedFlat([{ id: LB, date: '2026-09-10', net: '200.000' }]);
  const member = await memberWithoutPlanPermission(r);
  const grant = ids.newId();
  await r.h.owner`INSERT INTO permission_overrides(
    company_id,id,membership_id,permission_code,effect,scope_type,scope_id,reason,granted_by)
    VALUES (${r.company},${grant}::uuid,${member.membershipId}::uuid,
      'manage:commission-plans:business','ALLOW','BUSINESS',${r.business}::uuid,
      'repair replay proof',${r.userId})`;

  const first = await r.repair(body, 'revoked-replay', r.employee, member.cookie);
  await r.h
    .owner`DELETE FROM permission_overrides WHERE company_id=${r.company} AND id=${grant}::uuid`;
  const replay = await r.repair(body, 'revoked-replay', r.employee, member.cookie);

  expect(first.status).toBe(201);
  expect([replay.status, replay.body['code']]).toEqual([403, 'FORBIDDEN']);
  expect(replay.body['version']).toBeUndefined();
  expect(await repairWrites(r)).toEqual([1, 1, 1, 1]);
});
