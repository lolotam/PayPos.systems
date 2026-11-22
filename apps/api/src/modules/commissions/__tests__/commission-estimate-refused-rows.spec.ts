import { afterAll, beforeAll, expect, it } from 'vitest';

import { createDatabase, type Database } from '@pospay/db';

import {
  insertCommissionLineProjection,
  type CommissionLineTenant,
} from '../../../../../../packages/db/test/commission-line-fixtures.ts';
import { insertTipSalary } from '../../../../../../packages/db/test/commission-tip-salary-fixtures.ts';
import { walkCommissionStatement } from '../../../../../../packages/db/test/commission-statement-fixtures.ts';
import { insertCommissionCorrection } from '../../../../../../packages/db/test/commission-correction-fixtures.ts';
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

type RefusedRowsFixture = {
  readonly h: EstimateHarness;
  readonly db: Database;
  readonly cookie: string;
  readonly branchCookie: string;
  readonly secondBranchCookie: string;
  readonly company: string;
  readonly business: string;
  readonly branch: string;
  readonly secondBranch: string;
  readonly employee: string;
};

/**
 * موظفة متنقّلة ببند نسبة ثابتة في الفرع الأول وبند بيتبع خطة من غير خطة سارية
 * في الفرع التاني، وبقشيشين وتصحيحين على الفرعين، عشان إثبات إن البقشاش
 * والتصحيحات المعروفة بيفضلوا ظاهرين لما التسعير يرفض، والقارئ على مستوى
 * الفروع ما يشوفش اللي بره نطاقه.
 */
async function refusedRowsFixture(): Promise<RefusedRowsFixture> {
  const h = await startHarness();
  const db = createDatabase({ url: h.urls.app, ids });
  try {
    const cookie = await h.signedInOperator('commission-estimate-refused-rows@example.test');
    const company = await h.onboard(cookie, 'Refused rows employer');
    const { business, branch, secondBranch } = await seedBusiness(h, cookie, company);
    const { employee } = await seedEmployees(h, company, business, branch);
    const tenant = await seedCatalogue(h, company, business, branch, employee);
    const base = { h, db, company, business, branch, secondBranch, employee, tenant };
    await seedTransferAttachments(h, company, business, employee, branch, secondBranch);
    await seedSourceRows(db, { ...tenant, employee, branch }, secondBranch);
    await seedTips(db, { ...tenant, employee }, branch, secondBranch);
    await seedCorrections(
      h,
      db,
      { ...base, tenant: { ...tenant, employee, branch } },
      secondBranch,
    );
    const branchCookie = await branchManager({ h, company, business, branch });
    const secondBranchCookie = await branchManager({
      h,
      company,
      business,
      branch: secondBranch,
      suffix: '_second',
    });
    return {
      h,
      db,
      cookie,
      branchCookie,
      secondBranchCookie,
      company,
      business,
      branch,
      secondBranch,
      employee,
    };
  } catch (error) {
    await db.close().catch(() => undefined);
    await h.close().catch(() => undefined);
    throw error;
  }
}

/** ارتباطات الموظفة: أول نصف الشهر في الفرع الأول وباقيته في الفرع التاني. */
async function seedTransferAttachments(
  h: EstimateHarness,
  company: string,
  business: string,
  employee: string,
  branch: string,
  secondBranch: string,
): Promise<void> {
  for (const [branchId, from, to] of [
    [branch, '2026-11-01', '2026-11-15'],
    // نهاية في سنة بخمس أرقام: القارئ بيقصّها على الشهر في SQL، فترتيبها النصي
    // ما بيوصلش للمحرك. `::text::date` بيحافظ على القيمة الحرفية لحد ما
    // PostgreSQL نفسه يفسّرها كتاريخ، بدل ما الـ driver يعدّيها على Date.
    [secondBranch, '2026-11-15', '10000-01-01'],
  ] as const) {
    await h.owner`INSERT INTO employee_branches(
      company_id,id,business_id,employee_id,branch_id,"from","to")
      VALUES (${company},${ids.newId()},${business},${employee},${branchId},${from}::text::date,${to}::text::date)`;
  }
}

/** بند مرئي بنسبة ثابتة في الفرع الأول، وبند بيتبع خطة من غير خطة في التاني. */
async function seedSourceRows(
  db: Database,
  first: CommissionLineTenant,
  secondBranch: string,
): Promise<void> {
  await db.withTenant(first.company, (tx) =>
    insertCommissionLineProjection(tx, first, ids, {
      lineId: ids.newId(),
      businessDate: '2026-11-05',
      period: PERIOD,
      net: '10.000',
      ruleKind: 'PCT',
      rulePctBps: 1000,
    }),
  );
  await db.withTenant(first.company, (tx) =>
    insertCommissionLineProjection(tx, { ...first, branch: secondBranch }, ids, {
      lineId: ids.newId(),
      businessDate: '2026-11-20',
      period: PERIOD,
      net: '10.000',
      ruleKind: 'FOLLOW_PLAN',
    }),
  );
}

/** بقشيش كارت على الفرع الأول وبقشيش كاش على الفرع التاني. */
async function seedTips(
  db: Database,
  tenant: CommissionLineTenant,
  branch: string,
  secondBranch: string,
): Promise<void> {
  const card = ids.newId();
  const cash = ids.newId();
  await db.withTenant(tenant.company, async (tx) => {
    await insertTipSalary(
      tx,
      'commission_tip_heads',
      { ...tenant, branch },
      {
        session: card,
        businessDate: '2026-11-05',
        period: PERIOD,
        branch,
      },
    );
    await insertTipSalary(tx, 'commission_tips', tenant, {
      session: card,
      method: 'CARD',
      amount: '2.500',
    });
    await insertTipSalary(
      tx,
      'commission_tip_heads',
      { ...tenant, branch: secondBranch },
      {
        session: cash,
        businessDate: '2026-11-20',
        period: PERIOD,
        branch: secondBranch,
      },
    );
    await insertTipSalary(tx, 'commission_tips', tenant, {
      session: cash,
      method: 'CASH',
      amount: '1.000',
    });
  });
}

/** تصحيح مستلم على كل فرع، بعد كشف هدف بالحالة المراجعة. */
async function seedCorrections(
  h: EstimateHarness,
  db: Database,
  base: {
    readonly company: string;
    readonly business: string;
    readonly branch: string;
    readonly secondBranch: string;
    readonly employee: string;
    readonly tenant: CommissionLineTenant;
  },
  secondBranch: string,
): Promise<void> {
  const [membership] =
    await h.owner`SELECT id FROM memberships WHERE company_id=${base.company} LIMIT 1`;
  const [author] = await h.owner`SELECT id FROM "user" LIMIT 1`;
  const statementId = await walkCommissionStatement(db, {
    tenant: { ...base.tenant, membership: membership?.['id'] as string },
    reviewer: author?.['id'] as string,
    period: PERIOD,
    ids,
    to: 'REVIEWED',
  });
  await db.withTenant(base.company, (tx) =>
    Promise.all([
      insertCommissionCorrection(tx, base.tenant, ids, statementId, {
        targetPeriod: PERIOD,
        attachedBranchIds: [base.branch],
        amount: '5.000',
        previousAmount: '0.000',
        newAmount: '5.000',
      }),
      insertCommissionCorrection(tx, { ...base.tenant, branch: secondBranch }, ids, statementId, {
        targetPeriod: PERIOD,
        attachedBranchIds: [secondBranch],
        amount: '3.000',
        previousAmount: '0.000',
        newAmount: '3.000',
      }),
    ]),
  );
}

let fixture: RefusedRowsFixture;

beforeAll(async () => {
  fixture = await refusedRowsFixture();
});

afterAll(async () => {
  await fixture?.db.close().catch(() => undefined);
  await fixture?.h.close();
});

type EstimateBody = {
  employees: {
    employee_id: string;
    total: string | null;
    status: string;
    tips: { card: string; cash: string };
    corrections: { amount: string }[];
    sources: unknown[];
    sales: unknown[];
  }[];
  total: string | null;
};

const get = (cookie: string) =>
  fixture.h.send('GET', estimatePath(fixture.business, PERIOD), {
    cookie,
    company: fixture.company,
  });

it('keeps the known tips and corrections of the branch reader while her month prices', async () => {
  const response = await get(fixture.branchCookie);

  expect(response.status).toBe(200);
  const body = response.body as EstimateBody;
  expect(body.employees).toHaveLength(1);
  expect(body.employees[0]?.status).toBe('OK');
  expect(body.employees[0]?.total).toBe('1.000');
  expect(body.employees[0]?.tips).toEqual({ card: '2.500', cash: '0.000' });
  expect(body.employees[0]?.corrections.map((correction) => correction.amount)).toEqual(['5.000']);
});

it('keeps the whole tips and corrections of the reader who sees the refused source', async () => {
  const response = await get(fixture.cookie);

  expect(response.status).toBe(200);
  const body = response.body as EstimateBody;
  expect(body.employees[0]?.status).toBe('NO_PLAN');
  expect(body.employees[0]?.total).toBeNull();
  expect(body.total).toBeNull();
  expect(body.employees[0]?.tips).toEqual({ card: '2.500', cash: '1.000' });
  expect(body.employees[0]?.corrections.map((correction) => correction.amount).sort()).toEqual([
    '3.000',
    '5.000',
  ]);
});

it('keeps only the in-scope tips and corrections of the branch reader who sees the refusal', async () => {
  const response = await get(fixture.secondBranchCookie);

  expect(response.status).toBe(200);
  const body = response.body as EstimateBody;
  expect(body.employees).toHaveLength(1);
  expect(body.employees[0]?.status).toBe('NO_PLAN');
  expect(body.employees[0]?.total).toBeNull();
  expect(body.employees[0]?.sources).toEqual([]);
  expect(body.employees[0]?.sales).toEqual([]);
  expect(body.employees[0]?.tips).toEqual({ card: '0.000', cash: '1.000' });
  expect(body.employees[0]?.corrections.map((correction) => correction.amount)).toEqual(['3.000']);
});

it('reads the estimate in one read-only repeatable-read transaction', async () => {
  fixture.h.calls.memberSnapshots.length = 0;
  fixture.h.calls.tenant.length = 0;

  const response = await get(fixture.cookie);

  expect(response.status).toBe(200);
  // معاملة مستأجر واحدة بس في الطلب كله، فكل قراءات التقدير جوه نفس اللقطة.
  expect(fixture.h.calls.tenant).toEqual([fixture.company]);
  expect(fixture.h.calls.memberSnapshots).toEqual([
    { readOnly: 'on', isolation: 'repeatable read' },
  ]);
});
