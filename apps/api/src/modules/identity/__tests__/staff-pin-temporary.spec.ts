import { systemUuidV7 } from '@pospay/ids';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { createDatabase } from '@pospay/db';
import { startHarness, type Harness } from '../../../../test/harness.ts';
import { createStaffPinTransactions } from '../persistence/staff-pin-transactions.ts';

const ids = systemUuidV7();
let h: Harness;
let db: ReturnType<typeof createDatabase>;
let company: string;
let permanentUser: string;
let temporaryUser: string;
beforeAll(async () => {
  h = await startHarness();
  const cookie = await h.signedInOperator('staff-pin-temporary@example.test');
  company = await h.onboard(cookie, 'Temporary pin employer');
  db = createDatabase({ url: h.urls.app, ids });
  const business = ids.newId();
  await h.owner`INSERT INTO businesses (company_id,id,name_en,vertical_type)
    VALUES (${company},${business},'Temporary pin business','salon')`;
  const branch = ids.newId();
  await h.owner`INSERT INTO branches (company_id,id,business_id,name_en)
    VALUES (${company},${branch},${business},'Temporary pin branch')`;
  permanentUser = ids.newId();
  temporaryUser = ids.newId();
  for (const user of [permanentUser, temporaryUser]) {
    await h.owner`INSERT INTO "user"(id,name,email) VALUES (${user},'Probe',${`tp-${user}@example.test`})`;
    await h.owner`INSERT INTO memberships(company_id,id,user_id,role_id,role_owner_key,scope_type,scope_id)
      VALUES (${company},${ids.newId()},${user},'01920000-0000-7000-8000-00000000010b','global','BRANCH',${branch})`;
  }
  await db.withTenant(company, (tx) =>
    tx.execute(sql`INSERT INTO cashier_pins(company_id,id,user_id,pin_hash,set_by,set_at,temporary)
      VALUES (${company},${ids.newId()},${permanentUser},'pbkdf2-sha256$x$y$z',NULL,now(),false),
        (${company},${ids.newId()},${temporaryUser},'pbkdf2-sha256$x$y$z',NULL,now(),true)`),
  );
});
afterAll(async () => {
  await db?.close();
  await h?.close();
});

it('AC-F1-7c the reader sees a permanent PIN and refuses a temporary one like a wrong PIN', async () => {
  const staffPins = createStaffPinTransactions(db, ids);
  const permanent = await staffPins.run(company, null, (scope) => scope.find(permanentUser));
  expect(permanent).not.toBeNull();
  const temporary = await staffPins.run(company, null, (scope) => scope.find(temporaryUser));
  // الرقم المؤقت (حدده المانح) لا يراه القارئ إطلاقاً — نفس جواب «لا صف» أي PIN غلط حتى F2 (FR-F2-2).
  expect(temporary).toBeNull();
});
