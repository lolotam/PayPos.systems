import { SYSTEM_ROLES } from '@pospay/db';
import { systemUuidV7 } from '@pospay/ids';
import { afterAll, beforeAll, expect, it } from 'vitest';

import { startHarness, type Harness } from '../../../../../test/harness.ts';

let h: Harness;
let ownerCookie: string;
let memberCookie: string;
let company: string;
let userId: string;
beforeAll(async () => {
  h = await startHarness();
  ownerCookie = await h.signedInOperator('notifications-owner@example.test');
  memberCookie = await h.signedInOperator('notifications-member@example.test');
  company = await h.onboard(ownerCookie, 'Notification Test');
  const [user] =
    await h.owner`SELECT id FROM "user" WHERE email = 'notifications-member@example.test'`;
  userId = String(user?.['id']);
});
afterAll(async () => {
  await h.close();
});

it('delivery-log GET allows owner/manager and denies a cashier role and unauthenticated caller', async () => {
  const endpoint = '/v1/notifications/delivery-log';
  expect((await h.send('GET', endpoint, { cookie: ownerCookie, company })).status).toBe(200);
  expect((await h.send('GET', endpoint, { cookie: '', company })).status).toBe(401);
  for (const [code, status] of [
    ['cashier', 403],
    ['general_manager', 200],
  ] as const) {
    const role = SYSTEM_ROLES.find((r) => r.code === code);
    if (role === undefined) throw new Error('TEST_ROLE_MISSING');
    await h.owner`DELETE FROM memberships WHERE user_id = ${userId}`;
    await h.owner`INSERT INTO memberships (company_id,id,user_id,role_id,role_owner_key,scope_type,scope_id,starts_at)
      VALUES (${company},${systemUuidV7().newId()},${userId},${role.id},'global','COMPANY',${company},now()-interval '1 minute')`;
    expect((await h.send('GET', endpoint, { cookie: memberCookie, company })).status).toBe(status);
  }
});
