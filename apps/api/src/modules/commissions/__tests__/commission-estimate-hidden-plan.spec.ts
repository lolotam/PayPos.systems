import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';

import { createDatabase, type Database } from '@pospay/db';
import type { IdGenerator } from '@pospay/ids';

import {
  insertCommissionLineProjection,
  type CommissionLineTenant,
} from '../../../../../../packages/db/test/commission-line-fixtures.ts';
import { insertCommissionPlanVersion } from '../../../../../../packages/db/test/commission-plan-version-fixtures.ts';
import { startHarness } from '../../../../test/harness.ts';
import {
  branchManager,
  estimatePath,
  ids,
  seedBusiness,
  seedCatalogue,
  seedEmployees,
  type EstimateHarness,
} from './commission-estimate.fixture.ts';

const PERIOD = '2026-11';

type HiddenPlanFixture = {
  readonly h: EstimateHarness;
  readonly db: Database;
  readonly ids: IdGenerator;
  readonly cookie: string;
  readonly branchCookie: string;
  readonly company: string;
  readonly business: string;
  readonly branch: string;
  readonly secondBranch: string;
  readonly employee: string;
  readonly tenant: CommissionLineTenant;
};

/**
 * موظفة متنقّلة: أول نصف الشهر في الفرع الأول وباقيته في الفرع التاني. بند
 * الأول نسبة ثابتة فبتتسعّر من غير خطة، وبند التاني بيتبع خطة من غير خطة
 * سارية.
 */
async function hiddenPlanFixture(): Promise<HiddenPlanFixture> {
  const h = await startHarness();
  const db = createDatabase({ url: h.urls.app, ids });
  try {
    const cookie = await h.signedInOperator('commission-estimate-hidden-plan@example.test');
    const company = await h.onboard(cookie, 'Hidden plan employer');
    const { business, branch, secondBranch } = await seedBusiness(h, cookie, company);
    const { employee } = await seedEmployees(h, company, business, branch);
    const tenant = await seedCatalogue(h, company, business, branch, employee);
    await seedTransfer(h, company, business, employee, branch, secondBranch);
    await seedRows(db, company, tenant, employee, branch, secondBranch);
    const branchCookie = await branchManager({ h, company, business, branch });
    return {
      h,
      db,
      ids,
      cookie,
      branchCookie,
      company,
      business,
      branch,
      secondBranch,
      employee,
      tenant,
    };
  } catch (error) {
    await db.close().catch(() => undefined);
    await h.close().catch(() => undefined);
    throw error;
  }
}

/** ارتباطات الموظفة: أول نصف الشهر في الفرع الأول وباقيته في الفرع التاني. */
async function seedTransfer(
  h: EstimateHarness,
  company: string,
  business: string,
  employee: string,
  branch: string,
  secondBranch: string,
): Promise<void> {
  for (const [branchId, from, to] of [
    [branch, '2026-11-01', '2026-11-15'],
    [secondBranch, '2026-11-15', null],
  ] as const) {
    await h.owner`INSERT INTO employee_branches(
      company_id,id,business_id,employee_id,branch_id,"from","to")
      VALUES (${company},${ids.newId()},${business},${employee},${branchId},${from}::date,${to}::date)`;
  }
}

/** بند مرئي بنسبة ثابتة، وبند مخفي بيتبع خطة من غير خطة سارية. */
async function seedRows(
  db: Database,
  company: string,
  tenant: CommissionLineTenant,
  employee: string,
  branch: string,
  secondBranch: string,
): Promise<void> {
  await db.withTenant(company, (tx) =>
    insertCommissionLineProjection(tx, { ...tenant, employee, branch }, ids, {
      lineId: ids.newId(),
      businessDate: '2026-11-05',
      period: PERIOD,
      net: '10.000',
      ruleKind: 'PCT',
      rulePctBps: 1000,
    }),
  );
  await db.withTenant(company, (tx) =>
    insertCommissionLineProjection(tx, { ...tenant, employee, branch: secondBranch }, ids, {
      lineId: ids.newId(),
      businessDate: '2026-11-20',
      period: PERIOD,
      net: '10.000',
      ruleKind: 'FOLLOW_PLAN',
    }),
  );
}

let fixture: HiddenPlanFixture;

beforeAll(async () => {
  fixture = await hiddenPlanFixture();
});

beforeEach(async () => {
  await fixture.h.owner`DELETE FROM commission_plan_versions WHERE company_id=${fixture.company}`;
});

afterAll(async () => {
  await fixture?.db.close().catch(() => undefined);
  await fixture?.h.close();
});

type EstimateBody = {
  employees: { employee_id: string; total: string | null; status: string; sources: unknown[] }[];
  total: string | null;
};

it('keeps the visible amount and the cause of a hidden source out of the branch reader', async () => {
  const response = await fixture.h.send('GET', estimatePath(fixture.business, PERIOD), {
    cookie: fixture.branchCookie,
    company: fixture.company,
  });

  expect(response.status).toBe(200);
  const body = response.body as EstimateBody;
  expect(body.employees).toHaveLength(1);
  expect(body.employees[0]?.status).toBe('OK');
  expect(body.employees[0]?.total).toBe('1.000');
  expect(body.employees[0]?.sources).toHaveLength(1);
});

it('refuses the whole month for the reader who sees the source without its plan', async () => {
  const response = await fixture.h.send('GET', estimatePath(fixture.business, PERIOD), {
    cookie: fixture.cookie,
    company: fixture.company,
  });

  expect(response.status).toBe(200);
  const body = response.body as EstimateBody;
  expect(body.employees[0]?.status).toBe('NO_PLAN');
  expect(body.employees[0]?.total).toBeNull();
  expect(body.total).toBeNull();
});

it('prices the month with the repair plan of that month', async () => {
  // نسخة الإصلاح بتسري في شهرها بس، والفلتر في القراءة والتجمّع بيحافظوا عليها
  // (D-12, CS-Q11).
  const [author] = await fixture.h.owner`SELECT id FROM "user" LIMIT 1`;
  await fixture.db.withTenant(fixture.company, (tx) =>
    insertCommissionPlanVersion(tx, fixture.tenant, fixture.ids, {
      employeeId: fixture.employee,
      repairPeriod: PERIOD,
      createdBy: author?.['id'] as string,
      plan: {
        base: { enabled: false },
        tiers: { enabled: false },
        package_sale: { enabled: false },
      },
    }),
  );

  const response = await fixture.h.send('GET', estimatePath(fixture.business, PERIOD), {
    cookie: fixture.cookie,
    company: fixture.company,
  });

  expect(response.status).toBe(200);
  const body = response.body as EstimateBody;
  expect(body.employees[0]?.status).toBe('OK');
  expect(body.employees[0]?.total).toBe('1.000');
});
