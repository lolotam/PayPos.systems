import { createHash } from 'node:crypto';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { systemUuidV7 } from '@pospay/ids';
import {
  addEmployee,
  hashStaffPin,
  grant,
  nextPhone,
  capturedLogs,
  systemRoleId,
  staffAccessFixture,
  type Fixture,
} from '../../../../test/staff-access.fixture.ts';
const ids = systemUuidV7();
let f: Fixture;
beforeAll(async () => {
  f = await staffAccessFixture({ staffAccessRoutes: true });
});
afterAll(async () => {
  await f?.db.close();
  await f?.h.close();
});
it.each(['inside', 'outside'])(
  'P1-11 phone owned %s the company leaves that user PIN and sessions unchanged and logs no secrets',
  async (where) => {
    const phone = nextPhone(f);
    const userId = await phoneHolder(where, phone);
    const before = await holderState(userId);
    const employee = await addEmployee(
      f,
      'Refused ' + where,
      f.salmiya,
      where === 'inside' ? 401 : 402,
    );
    const pin = '8472';
    const response = await grant(f, employee, phone, f.ownerCookie, { pin });
    expect(response).toMatchObject({ status: 409, body: { code: 'STAFF_ACCESS_PHONE_TAKEN' } });
    expect(JSON.stringify(response.body)).not.toContain(userId);
    expect(await holderState(userId)).toEqual(before);
    expect(capturedLogs().includes(phone), 'Full phone is absent from logs').toBe(false);
    expect(capturedLogs().includes(pin), 'PIN is absent from logs').toBe(false);
  },
);

async function phoneHolder(where: string, phone: string): Promise<string> {
  const cookie = await f.h.signedInOperator(`phone-holder-${where}@example.test`);
  const holder = await f.h.auth.getSession(new Headers({ cookie }));
  if (holder === null) throw new Error('HOLDER_SESSION_MISSING');
  const userId = holder.userId;
  const company =
    where === 'inside' ? f.company : await f.h.onboard(cookie, 'Foreign phone employer');
  await f.h.owner`UPDATE "user" SET phone_number=${phone} WHERE id=${userId}`;
  await f.h.owner`UPDATE "user" SET phone_binding_approved_at=now() WHERE id=${userId}`;
  if (where === 'inside')
    await f.h
      .owner`INSERT INTO memberships(company_id,id,user_id,role_id,role_owner_key,scope_type,scope_id)
    VALUES (${company},${ids.newId()},${userId},${systemRoleId('accountant')},'global','COMPANY',${company})`;
  const hash = await hashStaffPin('9026');
  await f.h.owner`INSERT INTO cashier_pins(company_id,id,user_id,pin_hash,set_at,temporary)
    VALUES (${company},${ids.newId()},${userId},${hash},now(),false)`;
  expect(await f.h.owner`SELECT id FROM session WHERE user_id=${userId}`).not.toHaveLength(0);
  return userId;
}

async function holderState(userId: string) {
  const pins = await f.h.owner`SELECT * FROM cashier_pins WHERE user_id=${userId} ORDER BY id`;
  const sessions = await f.h.owner`SELECT * FROM session WHERE user_id=${userId} ORDER BY id`;
  const fingerprint = (rows: unknown) =>
    createHash('sha256').update(JSON.stringify(rows)).digest('hex');
  return { pins: fingerprint(pins), sessions: fingerprint(sessions) };
}
