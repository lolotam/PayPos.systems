import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { present } from '../../../../../../packages/db/test/present.ts';
import { origin, paired, phone } from '../../../../test/staff-otp-harness.ts';
import { startHarness, type Harness } from '../../../../test/harness.ts';

const ownPin = '1234';

let h: Harness,
  manager: string,
  company: string,
  business: string,
  branch: string,
  device: Awaited<ReturnType<typeof paired>>,
  userId: string,
  staffCookie: string;

const staffHeaders = (extra: Record<string, string> = {}) => ({
  authorization: `Device ${device.token}`,
  origin,
  ...extra,
});
const openWindow = (pin: string) =>
  h.app.inject({
    method: 'POST',
    url: '/v1/staff/me/private-view',
    headers: staffHeaders({ cookie: staffCookie }),
    payload: { pin },
  });
// سطور فتح النافذة; الرفض ما بيكتبش سطر.
const countOpenings = async (): Promise<number> => {
  const rows = await h.owner`SELECT count(*)::int AS n FROM audit_log
    WHERE company_id=${company} AND action='staff.private_view_opened'`;
  return Number(rows[0]?.['n'] ?? 0);
};
const markTemporary = async (temporary: boolean): Promise<void> => {
  await h.owner`UPDATE cashier_pins SET temporary=${temporary}
    WHERE company_id=${company} AND user_id=${userId}`;
};

beforeAll(async () => {
  h = await startHarness({ staffOrigin: origin });
  manager = await h.signedInOperator('private-view-temporary-operator@synthetic.invalid');
  company = await h.onboard(manager, 'Synthetic Private View Temporary');
  business = (
    await h.send('POST', '/v1/businesses', {
      cookie: manager,
      company,
      key: 'private-view-temporary-business',
      body: { vertical_type: 'salon', name_en: 'Synthetic' },
    })
  ).body['id'] as string;
  branch = (
    await h.send('POST', `/v1/businesses/${business}/branches`, {
      cookie: manager,
      company,
      key: 'private-view-temporary-branch',
      body: { name_en: 'Synthetic' },
    })
  ).body['id'] as string;
  device = await paired(h, manager, company, branch);
  userId = await h.auth.provisionUser({
    email: 'private-view-temporary-user@synthetic.invalid',
    name: 'Synthetic',
    password: 'synthetic'.repeat(8),
  });
  await h.owner`UPDATE "user" SET phone_number=${phone} WHERE id=${userId}`;
  await h.owner`UPDATE "user" SET phone_binding_approved_at=clock_timestamp() WHERE id=${userId}`;
  await h.owner`INSERT INTO memberships(company_id,id,user_id,role_id,role_owner_key,scope_type,scope_id)
      SELECT ${company},${randomUUID()},${userId},id,'global','BRANCH',${branch} FROM roles WHERE code='staff' AND company_id IS NULL`;
  // اعتماد دائم من مسار إعادة التعيين الحقيقي، عشان الموظف يدخل ب-session OTP قبل ما الـ PIN يبقى مؤقت.
  expect(
    (
      await h.send('POST', '/v1/staff-pins/reset', {
        cookie: manager,
        company,
        body: { user_id: userId, pin: ownPin },
      })
    ).status,
  ).toBe(204);
  const signedIn = await h.app.inject({
    method: 'POST',
    url: '/v1/devices/me/staff-pin/sign-in',
    headers: { authorization: `Device ${device.token}`, origin },
    payload: { phone, pin: ownPin },
  });
  expect(signedIn.statusCode).toBe(200);
  staffCookie = present(String(signedIn.headers['set-cookie']).split(';')[0]);
});
afterAll(async () => {
  await h?.close();
});

it('AC-ACT-8 a temporary PIN is refused like a wrong PIN and counts on the same counter', async () => {
  const before = await countOpenings();
  const wrong = await openWindow('9999');
  expect(wrong.statusCode).toBe(401);
  expect(wrong.json().code).toBe('PIN_INVALID');

  await markTemporary(true);
  const refused = await openWindow(ownPin);
  expect(refused.statusCode).toBe(401);
  // نفس جواب الـ PIN الغلط بالظبط — ولا حاجة في الرد بتقول إن الـ PIN مؤقت.
  expect(refused.json()).toEqual(wrong.json());
  expect(refused.json()).not.toHaveProperty('window_id');
  // المحاولة اتحسبت على عدّاد قفل الموظف نفسه.
  expect(await h.redis.get(`pin:${company}:staff-user:${userId}:failures`)).toBe('2');
  expect(await countOpenings()).toBe(before);
});

it('AC-ACT-8 a permanent PIN still opens the private view', async () => {
  const before = await countOpenings();
  await markTemporary(false);
  const opened = await openWindow(ownPin);
  expect(opened.statusCode).toBe(200);
  expect(opened.json().window_id).toEqual(expect.any(String));
  expect(await countOpenings()).toBe(before + 1);
});
