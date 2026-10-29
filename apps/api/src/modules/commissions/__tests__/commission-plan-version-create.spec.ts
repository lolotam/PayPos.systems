import { commissionPlanVersion } from '@pospay/contracts';
import { afterAll, beforeAll, expect, it } from 'vitest';

import {
  closeCommissionFixture,
  commissionPlanInput,
  commissionPlanVersionsFixture,
  versionAndAuditCounts,
  type CommissionPlanFixture,
} from './commission-plan-versions.fixture.ts';

let f: CommissionPlanFixture;
beforeAll(async () => {
  f = await commissionPlanVersionsFixture();
});
afterAll(async () => {
  await closeCommissionFixture(f);
});

it('CM-05 stores the next version, one safe audit row, and echoes the stored row', async () => {
  const first = await f.post(commissionPlanInput(), 'cm-05-first');
  expect(first.status).toBe(201);
  const second = await f.post(commissionPlanInput(), 'cm-05-second');
  expect(second.status).toBe(201);
  const created = commissionPlanVersion.parse(second.body);
  expect(created.version).toBe(2);
  expect(created.employee_id).toBe(f.employee);
  expect(created.created_by).toBe(f.userId);
  const [stored] = await f.h.owner`SELECT employee_id,version,effective_from,whole_period,
    repair_period,plan,created_by FROM commission_plan_versions WHERE id=${created.id}`;
  expect(stored).toMatchObject({
    employee_id: f.employee,
    version: 2,
    effective_from: '2026-10-30',
    whole_period: false,
    repair_period: null,
    created_by: f.userId,
  });
  expect(stored?.['plan']).toEqual({
    base: created.base,
    tiers: created.tiers,
    package_sale: created.package_sale,
  });
  const audits = await f.h.owner`SELECT actor_user_id,after FROM audit_log
    WHERE entity='commission_plan' AND entity_id=${created.id}
      AND action='commission_plan.version_created'`;
  expect(audits).toHaveLength(1);
  expect(audits[0]?.['actor_user_id']).toBe(f.userId);
  expect(JSON.stringify(audits[0]?.['after'])).not.toContain('500.000');
  const listed = await f.list({ limit: 1, cursor: 3 });
  expect(listed.items[0]).toEqual(created);
});

it('an idempotent replay returns the same version without a second row or audit', async () => {
  const input = commissionPlanInput();
  const first = await f.post(input, 'cm-replay');
  const replay = await f.post(input, 'cm-replay');
  expect(replay.status).toBe(first.status);
  expect(replay.body).toEqual(first.body);
  const rows = await f.h.owner`SELECT id FROM commission_plan_versions WHERE id=${first.body['id'] as string}`;
  expect(rows).toHaveLength(1);
  const audits = await f.h.owner`SELECT id FROM audit_log
    WHERE action='commission_plan.version_created' AND entity_id=${first.body['id'] as string}`;
  expect(audits).toHaveLength(1);
});

it('a reused key with another body is refused and writes nothing new', async () => {
  const before = await versionAndAuditCounts(f);
  const first = await f.post(commissionPlanInput(), 'cm-key-reused');
  expect(first.status).toBe(201);
  const changed = { ...commissionPlanInput('2026-10-31'), whole_period: true };
  const replay = await f.post(changed, 'cm-key-reused');
  expect([replay.status, replay.body['code']]).toEqual([422, 'IDEMPOTENCY_KEY_REUSED']);
  expect(await versionAndAuditCounts(f)).toEqual([before[0]! + 1, before[1]! + 1]);
});

it('a missing employee is 404 and no plan or audit is written', async () => {
  const before = await versionAndAuditCounts(f);
  const missing = f.employee.endsWith('f')
    ? `${f.employee.slice(0, -1)}e`
    : `${f.employee.slice(0, -1)}f`;
  const response = await f.post(commissionPlanInput(), 'cm-missing-employee', missing);
  expect([response.status, response.body['code']]).toEqual([404, 'EMPLOYEE_NOT_FOUND']);
  expect(await versionAndAuditCounts(f)).toEqual(before);
});
