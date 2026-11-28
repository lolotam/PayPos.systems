import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import ts from 'typescript';

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

async function assertNativeOriginPair(
  h: Harness,
  method: 'GET' | 'POST',
  url: string,
  headers: Record<string, string>,
  allowedStatus: number,
  payload?: Record<string, unknown>,
) {
  const allowed = await h.app.inject({
    method,
    url,
    headers: { ...headers, origin: nativeOrigin },
    ...(payload === undefined ? {} : { payload }),
  });
  expect(allowed.statusCode).toBe(allowedStatus);
  const refused = await h.app.inject({
    method,
    url,
    headers: { ...headers, origin: foreignOrigin },
    ...(payload === undefined ? {} : { payload }),
  });
  expect(refused.statusCode).toBe(403);
}

async function assertClockAndLeaveNative(
  h: Harness,
  device: Awaited<ReturnType<typeof paired>>,
  cookie: string,
) {
  const auth = { authorization: `Device ${device.token}`, cookie };
  await assertNativeOriginPair(h, 'GET', '/v1/devices/me/staff-session', auth, 200);
  await assertNativeOriginPair(
    h,
    'POST',
    '/v1/devices/me/clock-by-card',
    { ...auth, 'idempotency-key': 'native-card-1' },
    404,
    { card_code: 'SYNTH-1234' },
  );
  // StaffLeaveGuard runs before pipe validation: foreignOrigin throws 403, nativeOrigin reaches query pipe (400).
  await assertNativeOriginPair(
    h,
    'GET',
    '/v1/staff/me/leave-requests?branch_id=not-a-uuid',
    auth,
    400,
  );
  await assertNativeOriginPair(
    h,
    'POST',
    '/v1/staff/me/leave-requests?branch_id=not-a-uuid',
    auth,
    400,
    {},
  );
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

interface MethodInfo {
  readonly name: string;
  readonly decorators: string;
  readonly bodyText: string;
}

interface ControllerSpec {
  readonly file: string;
  readonly direct?: readonly string[];
  readonly signOut?: readonly string[];
  readonly classGuard?: string;
  readonly guardMethods?: readonly string[];
  readonly privateView?: readonly string[];
}

function classInfoOf(source: string): {
  readonly classDecorators: string;
  readonly methods: ReadonlyMap<string, MethodInfo>;
} {
  const file = ts.createSourceFile('probe.ts', source, ts.ScriptTarget.Latest, true);
  const methods = new Map<string, MethodInfo>();
  let classDecorators = '';
  const visit = (node: ts.Node): void => {
    if (ts.isClassDeclaration(node) && ts.canHaveDecorators(node)) {
      classDecorators =
        ts
          .getDecorators(node)
          ?.map((d) => d.getText(file))
          .join('\n') ?? '';
    }
    if (ts.isMethodDeclaration(node) && node.body !== undefined) {
      const name = node.name.getText(file);
      const decorators = ts.canHaveDecorators(node)
        ? (ts
            .getDecorators(node)
            ?.map((d) => d.getText(file))
            .join('\n') ?? '')
        : '';
      methods.set(name, { name, decorators, bodyText: node.body.getText(file) });
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return { classDecorators, methods };
}

function reachesStaffOrigin(
  method: MethodInfo,
  methods: ReadonlyMap<string, MethodInfo>,
  seen = new Set<string>(),
): boolean {
  if (method.bodyText.includes('isStaffOrigin(')) return true;
  if (seen.has(method.name)) return false;
  seen.add(method.name);
  for (const [, called] of method.bodyText.matchAll(/\bthis\.([A-Za-z0-9_]+)\s*\(/g)) {
    const helper = called === undefined ? undefined : methods.get(called);
    if (helper !== undefined && reachesStaffOrigin(helper, methods, seen)) return true;
  }
  return false;
}

const STAFF_CONTROLLER_SPECS: readonly ControllerSpec[] = [
  { file: 'src/modules/identity/http/staff-pin.controller.ts', direct: ['signIn', 'change'] },
  {
    file: 'src/modules/identity/http/staff-pin-reset.controller.ts',
    direct: ['request', 'reset'],
  },
  {
    file: 'src/modules/identity/http/staff-otp.controller.ts',
    direct: ['request', 'verify', 'session'],
    signOut: ['signOut'],
  },
  {
    file: 'src/modules/identity/http/private-view.controller.ts',
    direct: ['open', 'touch', 'close'],
  },
  { file: 'src/modules/staff/http/clock-by-card.controller.ts', direct: ['submit'] },
  {
    file: 'src/modules/staff/http/own-leave.controller.ts',
    classGuard: 'StaffLeaveGuard',
    guardMethods: ['request', 'cancelRequest', 'list'],
  },
  { file: 'src/modules/staff/http/own-attendance.controller.ts', privateView: ['read'] },
  {
    file: 'src/modules/commissions/http/own-commission-estimate.controller.ts',
    privateView: ['estimate'],
  },
  { file: 'src/modules/orders/http/own-work.controller.ts', privateView: ['tips', 'serviceLines'] },
];

function verifyStaffController(apiSrcRoot: string, spec: ControllerSpec): void {
  const source = readFileSync(join(apiSrcRoot, spec.file), 'utf8');
  expect(source).not.toMatch(/headers\.origin\s*[!=]==?/);
  const { classDecorators, methods } = classInfoOf(source);
  const actualStaff = [...methods.values()]
    .filter((m) => /SetMetadata\(\s*STAFF_ROUTE\b/.test(m.decorators))
    .map((m) => m.name)
    .sort();
  const expectedStaff = [
    ...(spec.direct ?? []),
    ...(spec.guardMethods ?? []),
    ...(spec.privateView ?? []),
  ].sort();
  expect(actualStaff, `${spec.file} STAFF_ROUTE inventory`).toEqual(expectedStaff);
  const actualSignOut = [...methods.values()]
    .filter((m) => /SignOutRoute\(\s*'staff'\s*\)/.test(m.decorators))
    .map((m) => m.name)
    .sort();
  expect(actualSignOut, `${spec.file} SignOutRoute('staff')`).toEqual(
    [...(spec.signOut ?? [])].sort(),
  );
  if (spec.classGuard !== undefined) {
    expect(classDecorators).toMatch(new RegExp(`UseGuards\\(\\s*${spec.classGuard}\\b`));
  }
  for (const name of spec.direct ?? []) {
    const handler = methods.get(name);
    expect(handler, `${spec.file}#${name}`).toBeDefined();
    if (handler !== undefined) {
      expect(reachesStaffOrigin(handler, methods), `${spec.file}#${name}`).toBe(true);
    }
  }
  for (const name of spec.privateView ?? []) {
    expect(methods.get(name)?.decorators, `${spec.file}#${name}`).toMatch(/@PrivateViewRoute\(/);
  }
}

describe('every staff route handler checks Origin exclusively through isStaffOrigin (#666)', () => {
  const apiSrcRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');

  it.each(STAFF_CONTROLLER_SPECS)(
    '%s enforces isStaffOrigin on its exact handler inventory',
    (spec) => {
      verifyStaffController(apiSrcRoot, spec);
    },
  );

  it('staff guards check Origin through isStaffOrigin without direct equality on staff routes', () => {
    for (const relativePath of [
      'src/modules/staff/http/staff-leave.guard.ts',
      'src/shared/private-view.guard.ts',
    ]) {
      const source = readFileSync(join(apiSrcRoot, relativePath), 'utf8');
      expect(source).not.toMatch(/headers\.origin\s*[!=]==?/);
      expect(source).toContain('isStaffOrigin(');
    }
    const signOutSource = readFileSync(join(apiSrcRoot, 'src/shared/sign-out.guard.ts'), 'utf8');
    expect(signOutSource).toMatch(/kind === 'staff'\s*\?\s*isStaffOrigin\(/);
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
