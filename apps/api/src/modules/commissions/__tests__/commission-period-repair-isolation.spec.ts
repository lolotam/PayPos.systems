import { employeeNameMatchKey } from '@pospay/domain';
import postgres from 'postgres';
import { afterEach, beforeEach, expect, it } from 'vitest';

import { insertCommissionLineProjection } from '../../../../../../packages/db/test/commission-line-fixtures.ts';
import { createCommissionPeriodRepairTransactions } from '../persistence/drizzle-commission-period-repair-transactions.ts';
import { repairCommissionPeriod } from '../use-cases/repair-commission-period/repair-commission-period.usecase.ts';
import {
  COMMISSION_NOW,
  ids,
  memberWithoutPlanPermission,
} from './commission-plan-versions.fixture.ts';
import {
  flatPlan,
  NO_PLAN_REPAIR,
  repairFixture,
  repairWrites,
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

const LB = ids.newId();
const body = { period: '2026-09', plan: NO_PLAN_REPAIR };
const seedFlat = (planFrom = '2026-09-15') =>
  seedBlockedSeptember(r, {
    plan: flatPlan(1000),
    planFrom,
    lines: [{ id: LB, date: '2026-09-10', net: '200.000' }],
    frozen: [],
  });

async function employeeOfAnotherBusiness(): Promise<string> {
  const created = await r.h.send('POST', '/v1/businesses', {
    cookie: r.cookie,
    company: r.company,
    key: 'repair-other-business',
    body: { vertical_type: 'salon', name_en: 'Repair other business', timezone: 'Asia/Kuwait' },
  });
  const business = created.body['id'] as string;
  const branch = await r.h.send('POST', `/v1/businesses/${business}/branches`, {
    cookie: r.cookie,
    company: r.company,
    key: 'repair-other-branch',
    body: { name_en: 'Repair other branch' },
  });
  const employee = ids.newId();
  await r.h.owner`INSERT INTO employees(
    company_id,id,business_id,primary_branch_id,name_en,name_en_key,role_code,hire_date,employee_number)
    VALUES (${r.company},${employee},${business},${branch.body['id'] as string},
      'Other business employee',${employeeNameMatchKey('Other business employee')},'staff','2026-01-01',2)`;
  return employee;
}

async function employeeOfAnotherCompany(): Promise<string> {
  const company = await r.h.onboard(r.cookie, 'Repair foreign company');
  const [business, branch, employee] = [ids.newId(), ids.newId(), ids.newId()];
  await r.h.owner`INSERT INTO businesses(company_id,id,name_en,vertical_type,timezone)
    VALUES (${company},${business},'Repair foreign business','salon','Asia/Kuwait')`;
  await r.h.owner`INSERT INTO branches(company_id,id,business_id,name_en)
    VALUES (${company},${branch},${business},'Repair foreign branch')`;
  await r.h.owner`INSERT INTO employees(
    company_id,id,business_id,primary_branch_id,name_en,name_en_key,role_code,hire_date,employee_number)
    VALUES (${company},${employee},${business},${branch},'Foreign employee',
      ${employeeNameMatchKey('Foreign employee')},'staff','2026-01-01',1)`;
  return employee;
}

it.each([
  ['another business of the same company', employeeOfAnotherBusiness],
  ['another company', employeeOfAnotherCompany],
])('a real employee of %s is refused with 404 and writes nothing', async (_name, seedEmployee) => {
  await seedFlat();
  const stranger = await seedEmployee();
  const before = await repairWrites(r);

  const response = await r.repair(body, 'foreign-real-employee', stranger);

  expect([response.status, response.body['code']]).toEqual([404, 'EMPLOYEE_NOT_FOUND']);
  expect(await repairWrites(r)).toEqual(before);
});

it('an October line before any ordinary plan stays NO_PLAN after a September repair: the repair never falls back outside its month', async () => {
  await seedFlat('2026-10-15');
  expect((await r.repair(body, 'no-leak')).status).toBe(201);
  await r.db.withTenant(r.company, (tx) =>
    insertCommissionLineProjection(tx, r.tenant, ids, {
      lineId: ids.newId(),
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

  const employees = estimate.body['employees'] as { employee_id: string; status: string }[];
  expect(employees.find((employee) => employee.employee_id === r.employee)?.status).toBe('NO_PLAN');
});

const CLAIM_TIMEOUT_MS = 5_000;

/** يستنى لحد ما الشرط يتحقق، أو يرجّع false عند انتهاء المهلة أو لما الطلب الأول يفشل (فالمحاولة تنتهي فوراً). */
async function observed(
  condition: () => Promise<boolean>,
  failed: () => boolean,
): Promise<boolean> {
  const deadline = performance.now() + CLAIM_TIMEOUT_MS;
  while (performance.now() < deadline && !failed()) {
    if (await condition()) return true;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  return false;
}

async function grantPlanPermission(membershipId: string): Promise<string> {
  const grant = ids.newId();
  await r.h.owner`INSERT INTO permission_overrides(
    company_id,id,membership_id,permission_code,effect,scope_type,scope_id,reason,granted_by)
    VALUES (${r.company},${grant}::uuid,${membershipId}::uuid,
      'manage:commission-plans:business','ALLOW','BUSINESS',${r.business}::uuid,
      'repair barrier proof',${r.userId})`;
  return grant;
}

// حدّ: السحب بيتم بـ SQL مباشر، فبيتخطى أقفال مسار إدارة الصلاحيات العادي؛ الاختبار بيثبت ترتيب الفحص بعد الانتظار مش مسار الإدارة.
const revokePlanPermission = (grant: string) =>
  r.h.owner`DELETE FROM permission_overrides WHERE company_id=${r.company} AND id=${grant}::uuid`;

/** الطلب التاني بالذات (استعلام الـ claim على idempotency_keys) واقف بسبب جلسة الأول اللي ماسكة معاملتها عند البوابة. */
const claimWaiterObserved = (failed: () => boolean) =>
  observed(async () => {
    const [row] = await r.h.owner`SELECT count(*)::int AS n
      FROM pg_stat_activity waiting
      JOIN pg_stat_activity holder ON holder.pid = ANY(pg_blocking_pids(waiting.pid))
      WHERE waiting.datname = current_database() AND waiting.wait_event_type = 'Lock'
        AND waiting.query ILIKE '%idempotency_keys%' AND holder.state = 'idle in transaction'`;
    return (row?.['n'] as number) > 0;
  }, failed);

it('a revocation committed while a duplicate waits on the in-flight key refuses the stored replay with the uniform 403', async () => {
  await seedFlat();
  const member = await memberWithoutPlanPermission(r);
  const grant = await grantPlanPermission(member.membershipId);
  const clock = { now: () => COMMISSION_NOW };
  const transactions = createCommissionPeriodRepairTransactions(r.db, ids, r.readers, clock);
  const command = {
    companyId: r.company,
    userId: member.userId,
    businessId: r.business,
    employeeId: r.employee,
    key: 'replay-barrier',
    fingerprint: 'e'.repeat(64),
    input: body,
  };
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let repaired: () => void = () => undefined;
  const firstDone = new Promise<void>((resolve) => {
    repaired = resolve;
  });
  let firstFailure: unknown;
  const first = transactions.run(command, async (scope) => {
    const result = await repairCommissionPeriod(scope, command, ids, clock);
    repaired();
    await gate;
    return result;
  });
  first.catch((error: unknown) => {
    firstFailure = error;
  });
  const secondOutcome = transactions
    .run(command, async () => {
      throw new Error('a duplicate of an in-flight key must replay, never run');
    })
    .then(
      () => 'answered',
      (error: unknown) => (error as { code?: string }).code,
    );
  const blocked = await (async () => {
    try {
      await Promise.race([firstDone, first.catch(() => undefined)]);
      const seen = await claimWaiterObserved(() => firstFailure !== undefined);
      if (seen) await revokePlanPermission(grant);
      return seen;
    } finally {
      release();
    }
  })();

  await first;
  expect(blocked, 'the duplicate was never observed waiting on the in-flight claim').toBe(true);
  expect(await secondOutcome).toBe('FORBIDDEN');
  expect(await repairWrites(r)).toEqual([1, 1, 1, 1]);
});

it('a revocation committed while the request waits on the employee row lock answers the uniform 403, never a block-state 422', async () => {
  const member = await memberWithoutPlanPermission(r);
  const grant = await grantPlanPermission(member.membershipId);
  // اتصال مستقل للماسك: r.h.owner اتصال واحد فقط ولو اتحجز الاستعلامات بتاعة المراقبة هتستنى.
  const holderDb = postgres(r.h.ownerUrl, { max: 1, onnotice: () => undefined });
  let holderPid = 0;
  let releaseLock: () => void = () => undefined;
  const lockReleased = new Promise<void>((resolve) => {
    releaseLock = resolve;
  });
  let holding: () => void = () => undefined;
  const held = new Promise<void>((resolve) => {
    holding = resolve;
  });
  const holder = holderDb.begin(async (tx) => {
    const [backend] = await tx`SELECT pg_backend_pid() AS pid`;
    holderPid = backend?.['pid'] as number;
    await tx`SELECT id FROM employees WHERE company_id=${r.company} AND id=${r.employee} FOR NO KEY UPDATE`;
    holding();
    await lockReleased;
  });
  await held;
  const request = r.repair(body, 'employee-lock-wait', r.employee, member.cookie);
  const waiting = await (async () => {
    try {
      const seen = await observed(
        async () => {
          const [row] = await r.h.owner`SELECT count(*)::int AS n FROM pg_stat_activity waiting
            WHERE waiting.datname = current_database() AND waiting.wait_event_type = 'Lock'
              AND waiting.query ILIKE '%employees%'
              AND ${holderPid} = ANY(pg_blocking_pids(waiting.pid))`;
          return (row?.['n'] as number) > 0;
        },
        () => false,
      );
      if (seen) await revokePlanPermission(grant);
      return seen;
    } finally {
      releaseLock();
    }
  })();
  const response = await request;
  await holder;
  await holderDb.end();

  expect(waiting, 'the request was never observed waiting on the employee row lock').toBe(true);
  expect([response.status, response.body['code']]).toEqual([403, 'FORBIDDEN']);
});
