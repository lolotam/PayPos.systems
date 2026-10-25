import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { present } from '../../../../../../packages/db/test/present.ts';
import { paired, origin } from '../../../../test/staff-otp-harness.ts';
import { startHarness, type Harness } from '../../../../test/harness.ts';

// مصدر التطبيق الأصلي (capacitor://localhost) مقبول مثل مصدر الـ POS، لكنه يُقبل فقط إذا كان مُعدّاً
// في STAFF_NATIVE_ORIGINS — الاختبار يثبت أن الطلب من مصدر غير معدّ يُرفض بإعداد ناقص.
const nativeOrigin = 'capacitor://localhost';
const foreignOrigin = 'https://evil.example';
const phone = '+99900000011';
const pin = String(31).padStart(4, '0');

interface Staff {
  readonly device: Awaited<ReturnType<typeof paired>>;
  readonly userId: string;
}

// جهاز مقترن وموظف واحد هما PIN مضبوط، عبر نفس مسارات الـ HTTP الحقيقية التي يصنع بها المدير المستخدم.
async function seed(h: Harness): Promise<Staff> {
  const manager = await h.signedInOperator('pin-native-manager@synthetic.invalid');
  const company = await h.onboard(manager, 'Synthetic native origin');
  const businessResponse = await h.send('POST', '/v1/businesses', {
    cookie: manager,
    company,
    key: 'pin-native-business',
    body: { vertical_type: 'salon', name_en: 'Synthetic' },
  });
  expect(businessResponse.status).toBe(201);
  const business = businessResponse.body['id'] as string;
  const branchResponse = await h.send('POST', `/v1/businesses/${business}/branches`, {
    cookie: manager,
    company,
    key: 'pin-native-branch',
    body: { name_en: 'Synthetic' },
  });
  expect(branchResponse.status).toBe(201);
  const branch = branchResponse.body['id'] as string;
  const device = await paired(h, manager, company, branch);
  const userId = await h.auth.provisionUser({
    email: 'pin-native-user@synthetic.invalid',
    name: 'Synthetic',
    password: 'synthetic'.repeat(8),
  });
  await h.owner`UPDATE "user" SET phone_number=${phone} WHERE id=${userId}`;
  await h.owner`UPDATE "user" SET phone_binding_approved_at=clock_timestamp() WHERE id=${userId}`;
  await h.owner`INSERT INTO memberships(company_id,id,user_id,role_id,role_owner_key,scope_type,scope_id)
    SELECT ${company},${randomUUID()},${userId},id,'global','BRANCH',${branch}
    FROM roles WHERE code='staff' AND company_id IS NULL`;
  const reset = await h.send('POST', '/v1/staff-pins/reset', {
    cookie: manager,
    company,
    body: { user_id: userId, pin },
  });
  expect(reset.status).toBe(204);
  return { device, userId };
}

const signIn = (h: Harness, device: Awaited<ReturnType<typeof paired>>, requestOrigin: string) =>
  h.app.inject({
    method: 'POST',
    url: '/v1/devices/me/staff-pin/sign-in',
    headers: { authorization: `Device ${device.token}`, origin: requestOrigin },
    payload: { phone, pin },
  });

const sessionCookie = (response: Awaited<ReturnType<typeof signIn>>): string =>
  String(present(response.headers['set-cookie']));

describe('the staff PIN route with the native origin configured', () => {
  let h: Harness;
  let staff: Staff;

  beforeAll(async () => {
    h = await startHarness({ staffOrigin: origin, staffNativeOrigins: [nativeOrigin] });
    staff = await seed(h);
  });

  afterAll(async () => {
    await h?.close();
  });

  it('accepts the configured native origin like the POS origin', async () => {
    const native = await signIn(h, staff.device, nativeOrigin);
    expect(native.statusCode).toBe(200);
    expect(native.json().user_id).toBe(staff.userId);
    expect(sessionCookie(native)).toContain('pospay-staff.session_token=');
    const pos = await signIn(h, staff.device, origin);
    expect(pos.statusCode).toBe(200);
    expect(sessionCookie(pos)).toContain('pospay-staff.session_token=');
  });

  it('refuses an origin that is neither the POS one nor the native one', async () => {
    const refused = await signIn(h, staff.device, foreignOrigin);
    expect(refused.statusCode).toBe(403);
    expect(refused.json().code).toBe('FORBIDDEN');
    expect(refused.headers['set-cookie']).toBeUndefined();
  });
});

describe('the staff PIN route without the native origin configured', () => {
  let h: Harness;
  let staff: Staff;

  beforeAll(async () => {
    h = await startHarness({ staffOrigin: origin });
    staff = await seed(h);
  });

  afterAll(async () => {
    await h?.close();
  });

  it('refuses the native origin when it is not configured', async () => {
    const refused = await signIn(h, staff.device, nativeOrigin);
    expect(refused.statusCode).toBe(403);
    expect(refused.json().code).toBe('FORBIDDEN');
    expect(refused.headers['set-cookie']).toBeUndefined();
    const pos = await signIn(h, staff.device, origin);
    expect(pos.statusCode).toBe(200);
    expect(sessionCookie(pos)).toContain('pospay-staff.session_token=');
  });
});
