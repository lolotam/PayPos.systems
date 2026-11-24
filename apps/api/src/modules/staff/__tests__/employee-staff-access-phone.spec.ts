import { afterAll, beforeAll, expect, it } from 'vitest';
import { systemUuidV7 } from '@pospay/ids';
import {
  addEmployee,
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
    const userId = ids.newId();
    const phone = nextPhone(f);
    const company =
      where === 'inside'
        ? f.company
        : await f.h.onboard(
            await f.h.signedInOperator('foreign-phone@example.test'),
            'Foreign phone employer',
          );
    await f.h.owner`INSERT INTO "user"(id,name,email,phone_number,phone_binding_approved_at)
    VALUES (${userId},'Unrelated holder',${`${userId}@example.test`},${phone},now())`;
    await f.h
      .owner`INSERT INTO memberships(company_id,id,user_id,role_id,role_owner_key,scope_type,scope_id)
    VALUES (${company},${ids.newId()},${userId},${systemRoleId('owner')},'global','COMPANY',${company})`;
    await f.h.owner`INSERT INTO cashier_pins(company_id,id,user_id,pin_hash,set_at,temporary)
    VALUES (${company},${ids.newId()},${userId},'untouched-existing-hash',now(),false)`;
    await f.h
      .owner`INSERT INTO session(id,user_id,token,expires_at) VALUES (${ids.newId()},${userId},${ids.newId()},now()+interval '1 hour')`;
    const pins = await f.h.owner`SELECT * FROM cashier_pins WHERE user_id=${userId}`;
    const sessions = await f.h.owner`SELECT * FROM session WHERE user_id=${userId}`;
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
    expect(await f.h.owner`SELECT * FROM cashier_pins WHERE user_id=${userId}`).toEqual(pins);
    expect(await f.h.owner`SELECT * FROM session WHERE user_id=${userId}`).toEqual(sessions);
    expect(capturedLogs()).not.toContain(phone);
    expect(capturedLogs()).not.toContain(pin);
  },
);
