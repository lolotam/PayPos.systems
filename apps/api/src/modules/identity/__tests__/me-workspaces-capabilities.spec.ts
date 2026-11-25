import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { startHarness, type Harness } from '../../../../test/harness.ts';

// AC-ACT-17: الأدمن لازم يعرف إن قدرة شريحة 076 مقفولة من قراءة موجودة أصلاً، بدل ما يطلب
// مسار مقفول ويرد 503 على كل صفحة موظفة وكل تحميل للوحة.
describe('GET /v1/me/workspaces capabilities', () => {
  let closed: Harness;
  let open: Harness;

  beforeAll(async () => {
    closed = await startHarness();
    open = await startHarness({ staffAccessRoutes: true });
  }, 120_000);

  afterAll(async () => {
    await closed.close();
    await open.close();
  });

  it('reports the staff-access capability as off while the gate is closed', async () => {
    const cookie = await closed.signedInOperator('capabilities-closed@example.test');
    const res = await closed.send('GET', '/v1/me/workspaces', { cookie });
    expect(res.status).toBe(200);
    expect(res.body['capabilities']).toEqual({ staff_access: false });
  });

  it('reports the staff-access capability as on when the gate is open', async () => {
    const cookie = await open.signedInOperator('capabilities-open@example.test');
    const res = await open.send('GET', '/v1/me/workspaces', { cookie });
    expect(res.status).toBe(200);
    expect(res.body['capabilities']).toEqual({ staff_access: true });
  });
});
