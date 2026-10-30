import { afterEach, beforeEach, expect, it } from 'vitest';

import {
  closeCommissionFixture,
  commissionPlanInput,
  commissionPlanVersionsFixture,
  setCommissionStatement,
  versionAndAuditCounts,
  type CommissionPlanFixture,
} from './commission-plan-versions.fixture.ts';

let f: CommissionPlanFixture;
beforeEach(async () => {
  f = await commissionPlanVersionsFixture();
});
afterEach(async () => {
  await closeCommissionFixture(f);
});

it('CM-07 an ordinary version before the business today is 422 with no writes', async () => {
  const before = await versionAndAuditCounts(f);
  const response = await f.post(commissionPlanInput('2026-10-29'), 'cm-07-yesterday');
  expect([response.status, response.body['code']]).toEqual([422, 'COMMISSION_EFFECTIVE_FROM_PAST']);
  expect(await versionAndAuditCounts(f)).toEqual(before);
});

it('CM-07 a whole_period version whose own month is REVIEWED is 409', async () => {
  await setCommissionStatement(f, '2026-09', 'REVIEWED');
  const before = await versionAndAuditCounts(f);
  const response = await f.post(
    { ...commissionPlanInput('2026-09-01'), whole_period: true },
    'cm-07-own-reviewed',
  );
  expect([response.status, response.body['code']]).toEqual([409, 'COMMISSION_PERIOD_NOT_DRAFT']);
  expect(await versionAndAuditCounts(f)).toEqual(before);
});

it('CM-07 a whole_period month before tracked statements is 409 with no writes', async () => {
  const count2001Statements = () => f.h.owner`SELECT count(*)::int AS count
    FROM commission_statements WHERE company_id=${f.company} AND business_id=${f.business}
      AND period LIKE '2001-%'`;
  const [beforeStatements] = await count2001Statements();
  const beforeWrites = await versionAndAuditCounts(f);
  const response = await f.post(
    { ...commissionPlanInput('2001-01-01'), whole_period: true },
    'cm-07-untracked-month',
  );
  expect([response.status, response.body['code']]).toEqual([409, 'COMMISSION_PERIOD_NOT_DRAFT']);
  const [afterStatements] = await count2001Statements();
  expect(afterStatements?.['count']).toBe(beforeStatements?.['count']);
  expect(await versionAndAuditCounts(f)).toEqual(beforeWrites);
});

it.each(['APPROVED', 'PAID'] as const)(
  'CM-07 a whole_period version whose own month is %s is closed',
  async (status) => {
    await setCommissionStatement(f, '2026-09', status);
    const before = await versionAndAuditCounts(f);
    const response = await f.post(
      { ...commissionPlanInput('2026-09-01'), whole_period: true },
      `cm-07-own-${status.toLowerCase()}`,
    );
    expect([response.status, response.body['code']]).toEqual([409, 'COMMISSION_PERIOD_CLOSED']);
    expect(await versionAndAuditCounts(f)).toEqual(before);
  },
);

it('CM-07 a closed month after the whole_period month refuses the write', async () => {
  await setCommissionStatement(f, '2026-09', 'DRAFT');
  await setCommissionStatement(f, '2026-10', 'APPROVED');
  const before = await versionAndAuditCounts(f);
  const response = await f.post(
    { ...commissionPlanInput('2026-09-01'), whole_period: true },
    'cm-07-later-closed',
  );
  expect([response.status, response.body['code']]).toEqual([409, 'COMMISSION_PERIOD_CLOSED']);
  expect(await versionAndAuditCounts(f)).toEqual(before);
});

it('CM-07 September DRAFT with October REVIEWED is accepted and October returns to DRAFT', async () => {
  await setCommissionStatement(f, '2026-09', 'DRAFT');
  await setCommissionStatement(f, '2026-10', 'REVIEWED');
  const response = await f.post(
    { ...commissionPlanInput('2026-09-01'), whole_period: true },
    'cm-07-reopen',
  );
  expect(response.status).toBe(201);
  const statements = await f.h.owner`SELECT period,status,reviewed_fingerprint,
    reviewed_statement_fingerprint,reviewed_by,reviewed_membership_id,reviewed_at
    FROM commission_statements WHERE company_id=${f.company} ORDER BY period`;
  expect(statements).toEqual([
    expect.objectContaining({ period: '2026-09', status: 'DRAFT' }),
    expect.objectContaining({
      period: '2026-10',
      status: 'DRAFT',
      reviewed_fingerprint: null,
      reviewed_statement_fingerprint: null,
      reviewed_by: null,
      reviewed_membership_id: null,
      reviewed_at: null,
    }),
  ]);
});
