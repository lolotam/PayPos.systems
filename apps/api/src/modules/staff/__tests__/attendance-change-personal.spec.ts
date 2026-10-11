import { afterAll, beforeAll, expect, it } from 'vitest';
import { clockByCardFixture, type CardFixture } from './clock-by-card.fixture.ts';
let f: CardFixture;
beforeAll(async () => {
  f = await clockByCardFixture();
});
afterAll(async () => {
  await f?.close();
});
it('ACR-10 refuses personal staff sessions on all attendance-change routes', async () => {
  const base = `/v1/businesses/${f.businessId}/attendance-change-requests`;
  for (const request of [
    { method: 'GET' as const, url: base },
    {
      method: 'POST' as const,
      url: base,
      payload: { kind: 'ADD_SESSION', employee_id: f.employeeId, reason: 'Synthetic request' },
    },
    { method: 'POST' as const, url: `${base}/${f.ids.newId()}/cancel`, payload: { revision: 0 } },
    {
      method: 'POST' as const,
      url: `${base}/${f.ids.newId()}/decide`,
      payload: { decision: 'APPROVED', revision: 0 },
    },
  ]) {
    const response = await f.app.inject({
      ...request,
      headers: { ...f.headers, 'x-company-id': f.companyId, 'idempotency-key': f.ids.newId() },
    });
    expect(response.statusCode).toBe(401);
    expect(response.json().code).toBe('UNAUTHENTICATED');
  }
});
