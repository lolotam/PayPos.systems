import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { present } from '../../../../../../packages/db/test/present.ts';
import {
  paired,
  origin,
  phone as otpPhone,
  staffHarness,
} from '../../../../test/staff-otp-harness.ts';
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

// جهاز مقترن وموظف واحد لهما PIN مضبوط بصلاحية الكاشير، عبر نفس مسارات الـ HTTP الحقيقية.
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
    FROM roles WHERE code='cashier' AND company_id IS NULL`;
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

const cookiePair = (setCookie: string): string => setCookie.split(';')[0] ?? '';

async function assertClockAndLeaveNative(
  h: Harness,
  device: Awaited<ReturnType<typeof paired>>,
  cookie: string,
) {
  const deviceHeader = `Device ${device.token}`;
  const sessionAllowed = await h.app.inject({
    method: 'GET',
    url: '/v1/devices/me/staff-session',
    headers: { authorization: deviceHeader, origin: nativeOrigin, cookie },
  });
  expect(sessionAllowed.statusCode).toBe(200);
  const sessionRefused = await h.app.inject({
    method: 'GET',
    url: '/v1/devices/me/staff-session',
    headers: { authorization: deviceHeader, origin: foreignOrigin, cookie },
  });
  expect(sessionRefused.statusCode).toBe(403);
  const cardAllowed = await h.app.inject({
    method: 'POST',
    url: '/v1/devices/me/clock-by-card',
    headers: {
      authorization: deviceHeader,
      origin: nativeOrigin,
      cookie,
      'idempotency-key': 'native-card-1',
    },
    payload: { card_code: 'SYNTH-1234' },
  });
  expect(cardAllowed.statusCode).toBe(404);
  const cardRefused = await h.app.inject({
    method: 'POST',
    url: '/v1/devices/me/clock-by-card',
    headers: {
      authorization: deviceHeader,
      origin: foreignOrigin,
      cookie,
      'idempotency-key': 'native-card-2',
    },
    payload: { card_code: 'SYNTH-1234' },
  });
  expect(cardRefused.statusCode).toBe(403);
  // StaffLeaveGuard runs before pipe validation: foreignOrigin throws 403, nativeOrigin reaches query pipe (400).
  const leaveAllowed = await h.app.inject({
    method: 'GET',
    url: '/v1/staff/me/leave-requests?branch_id=not-a-uuid',
    headers: { authorization: deviceHeader, origin: nativeOrigin, cookie },
  });
  expect(leaveAllowed.statusCode).toBe(400);
  const leaveRefused = await h.app.inject({
    method: 'GET',
    url: '/v1/staff/me/leave-requests?branch_id=not-a-uuid',
    headers: { authorization: deviceHeader, origin: foreignOrigin, cookie },
  });
  expect(leaveRefused.statusCode).toBe(403);
}

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

  it('accepts native origin across staff session, clock-by-card, staff leave guard and sign-out (#666)', async () => {
    const nativeSignIn = await signIn(h, staff.device, nativeOrigin);
    expect(nativeSignIn.statusCode).toBe(200);
    const cookie = cookiePair(sessionCookie(nativeSignIn));
    await assertClockAndLeaveNative(h, staff.device, cookie);
    const signOutRefused = await h.app.inject({
      method: 'POST',
      url: '/v1/devices/me/staff-session/sign-out',
      headers: { origin: foreignOrigin, cookie },
    });
    expect(signOutRefused.statusCode).toBe(403);
    const signOutAllowed = await h.app.inject({
      method: 'POST',
      url: '/v1/devices/me/staff-session/sign-out',
      headers: { origin: nativeOrigin, cookie },
    });
    expect(signOutAllowed.statusCode).toBe(200);
    expect(signOutAllowed.json().status).toBe('SIGNED_OUT');
  });
});

describe('the staff OTP request route with the native origin configured (#666)', () => {
  let staffOtp: Awaited<ReturnType<typeof staffHarness>>;
  let deviceToken: string;

  beforeAll(async () => {
    staffOtp = await staffHarness({ staffNativeOrigins: [nativeOrigin] });
    const manager = await staffOtp.h.signedInOperator('otp-native-manager@synthetic.invalid');
    const company = await staffOtp.h.onboard(manager, 'Synthetic OTP native origin');
    const b = await staffOtp.h.send('POST', '/v1/businesses', {
      cookie: manager,
      company,
      key: 'otp-native-b',
      body: { vertical_type: 'salon', name_en: 'Synthetic' },
    });
    const business = b.body['id'] as string;
    const br = await staffOtp.h.send('POST', `/v1/businesses/${business}/branches`, {
      cookie: manager,
      company,
      key: 'otp-native-br',
      body: { name_en: 'Synthetic' },
    });
    deviceToken = (await paired(staffOtp.h, manager, company, br.body['id'] as string)).token;
  });

  afterAll(async () => {
    await staffOtp?.close();
  });

  it('accepts the configured native origin and refuses foreign origin on staff OTP request', async () => {
    const allowed = await staffOtp.h.app.inject({
      method: 'POST',
      url: '/v1/devices/me/staff-otp/request',
      headers: { authorization: `Device ${deviceToken}`, origin: nativeOrigin },
      payload: { phone: otpPhone, locale: 'en' },
    });
    expect(allowed.statusCode).toBe(202);
    expect(allowed.json().status).toBe('ACCEPTED');
    const refused = await staffOtp.h.app.inject({
      method: 'POST',
      url: '/v1/devices/me/staff-otp/request',
      headers: { authorization: `Device ${deviceToken}`, origin: foreignOrigin },
      payload: { phone: otpPhone, locale: 'en' },
    });
    expect(refused.statusCode).toBe(403);
    expect(refused.json().code).toBe('FORBIDDEN');
  });
});

describe('staff route files check Origin exclusively through isStaffOrigin (#666)', () => {
  const apiSrcRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
  const staffFiles = [
    'src/modules/identity/http/staff-pin.controller.ts',
    'src/modules/identity/http/staff-otp.controller.ts',
    'src/modules/identity/http/private-view.controller.ts',
    'src/modules/staff/http/clock-by-card.controller.ts',
    'src/modules/staff/http/staff-leave.guard.ts',
    'src/shared/private-view.guard.ts',
  ];

  it.each(staffFiles)('%s never compares request.headers.origin directly', (relativePath) => {
    const source = readFileSync(join(apiSrcRoot, relativePath), 'utf8');
    expect(source).not.toMatch(/headers\.origin\s*[!=]==?/);
    expect(source).toContain('isStaffOrigin(');
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
