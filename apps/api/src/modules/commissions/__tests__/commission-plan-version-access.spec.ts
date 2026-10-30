import { afterAll, beforeAll, expect, it } from 'vitest';

import {
  approvedDeviceToken,
  closeCommissionFixture,
  commissionPlanInput,
  commissionPlanPath,
  commissionPlanVersionsFixture,
  memberWithoutPlanPermission,
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

it('CM-10 without the plan permission both routes are the uniform 403 and nothing is written', async () => {
  const member = await memberWithoutPlanPermission(f);
  const before = await versionAndAuditCounts(f);
  const created = await f.post(commissionPlanInput(), 'cm-10-no-permission', f.employee, member.cookie);
  const listed = await f.get('', f.employee, member.cookie);
  for (const response of [created, listed]) {
    expect([response.status, response.body['code']]).toEqual([403, 'FORBIDDEN']);
  }
  expect(await versionAndAuditCounts(f)).toEqual(before);
});

it('CM-10 a real device principal is refused even with a valid body and key', async () => {
  const token = await approvedDeviceToken(f);
  const before = await versionAndAuditCounts(f);
  const response = await f.h.app.inject({
    method: 'POST',
    url: commissionPlanPath(f.business, f.employee),
    headers: {
      authorization: `Device ${token}`,
      'x-company-id': f.company,
      'idempotency-key': 'cm-10-device',
    },
    payload: commissionPlanInput(),
  });
  expect(response.statusCode).toBe(403);
  expect((response.json() as { code: string }).code).toBe('FORBIDDEN');
  expect(await versionAndAuditCounts(f)).toEqual(before);
});

it('the write requires an Idempotency-Key before any plan row is created', async () => {
  const before = await versionAndAuditCounts(f);
  const response = await f.h.app.inject({
    method: 'POST',
    url: commissionPlanPath(f.business, f.employee),
    headers: { cookie: f.cookie, 'x-company-id': f.company },
    payload: commissionPlanInput(),
  });
  expect(response.statusCode).toBe(400);
  expect((response.json() as { code: string }).code).toBe('IDEMPOTENCY_KEY_REQUIRED');
  expect(await versionAndAuditCounts(f)).toEqual(before);
});
