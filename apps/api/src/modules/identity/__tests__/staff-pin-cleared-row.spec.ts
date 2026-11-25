import { createDatabase } from '@pospay/db';
import { systemUuidV7 } from '@pospay/ids';
import { afterAll, beforeAll, expect, it } from 'vitest';

import { startHarness, type Harness } from '../../../../test/harness.ts';
import { createStaffPinTransactions } from '../persistence/staff-pin-transactions.ts';
import { CLEARED_STAFF_PIN_HASH, hashStaffPin } from '../index.ts';

// F3-1: مسح الرقم السري قبل تغيير الهاتف يترك صفاً ببصمة «ممسوحة» (pospay_app لا يملك DELETE)؛
// كل قارئ للرقم لازم يعامله كأنه غير موجود، فيمر على مقارنة الرقم المفقود المقاسة بدل مقارنة بصمة وهمية.
const ids = systemUuidV7();
let h: Harness;
let company: string;
let userId: string;
let db: ReturnType<typeof createDatabase>;

beforeAll(async () => {
  h = await startHarness();
  const operator = await h.signedInOperator('cleared-pin-operator@synthetic.invalid');
  company = await h.onboard(operator, 'Synthetic Cleared PIN');
  userId = await h.auth.provisionUser({
    email: 'cleared-pin-user@synthetic.invalid',
    name: 'Synthetic',
    password: 'synthetic'.repeat(8),
  });
  db = createDatabase({ url: h.urls.app, ids });
});
afterAll(async () => {
  await db?.close();
  await h?.close();
});

const findPin = () =>
  createStaffPinTransactions(db, ids).run(company, null, (scope) => scope.find(userId));

const putPin = async (hash: string) =>
  h.owner`INSERT INTO cashier_pins(company_id,id,user_id,pin_hash,set_at,temporary)
    VALUES (${company},${ids.newId()},${userId},${hash},now(),true)
    ON CONFLICT (company_id,user_id) DO UPDATE SET pin_hash=EXCLUDED.pin_hash`;

it('a real PIN row is found and the cleared row is reported as no PIN at all', async () => {
  await putPin(await hashStaffPin('4321'));
  expect(await findPin()).toMatchObject({ temporary: true });
  await putPin(CLEARED_STAFF_PIN_HASH);
  expect(await findPin()).toBeNull();
});
