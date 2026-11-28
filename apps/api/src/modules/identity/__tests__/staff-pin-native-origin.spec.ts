import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import ts from 'typescript';

import { PATH_METADATA } from '@nestjs/common/constants.js';
import { API_CONTROLLERS } from '../../../app.ts';
import { SIGN_OUT_ROUTE } from '../../../shared/sign-out.guard.ts';
import { STAFF_ROUTE } from '../../../shared/staff-authentication.ts';
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

async function seedBranchDevice(h: Harness, tag: string) {
  const manager = await h.signedInOperator(`${tag}-manager@synthetic.invalid`);
  const company = await h.onboard(manager, `Synthetic ${tag}`);
  const b = await h.send('POST', '/v1/businesses', {
    cookie: manager,
    company,
    key: `${tag}-b`,
    body: { vertical_type: 'salon', name_en: 'Synthetic' },
  });
  expect(b.status).toBe(201);
  const br = await h.send('POST', `/v1/businesses/${b.body['id'] as string}/branches`, {
    cookie: manager,
    company,
    key: `${tag}-br`,
    body: { name_en: 'Synthetic' },
  });
  expect(br.status).toBe(201);
  const branch = br.body['id'] as string;
  return { manager, company, branch, device: await paired(h, manager, company, branch) };
}

// جهاز مقترن وموظف واحد لهما PIN مضبوط بصلاحية الكاشير، عبر نفس مسارات الـ HTTP الحقيقية.
async function seed(h: Harness): Promise<Staff> {
  const { manager, company, branch, device } = await seedBranchDevice(h, 'pin-native');
  const fixtureCredential = `${randomUUID()}${randomUUID()}`;
  const userId = await h.auth.provisionUser({
    email: 'pin-native-user@synthetic.invalid',
    name: 'Synthetic',
    password: fixtureCredential,
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
    deviceToken = (await seedBranchDevice(staffOtp.h, 'otp-native')).device.token;
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

function classInfoOf(source: string) {
  const file = ts.createSourceFile('probe.ts', source, ts.ScriptTarget.Latest, true);
  const methods = new Map<string, MethodInfo>();
  let classDecorators = '';
  const decs = (n: ts.Node) =>
    ts.canHaveDecorators(n)
      ? (ts
          .getDecorators(n)
          ?.map((d) => d.getText(file))
          .join('\n') ?? '')
      : '';
  const visit = (node: ts.Node): void => {
    if (ts.isClassDeclaration(node)) classDecorators = decs(node);
    if (ts.isMethodDeclaration(node) && node.body !== undefined) {
      const name = node.name.getText(file);
      methods.set(name, { name, decorators: decs(node), bodyText: node.body.getText(file) });
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return { classDecorators, methods };
}

function reachesStaffOrigin(
  m: MethodInfo,
  methods: ReadonlyMap<string, MethodInfo>,
  seen = new Set<string>(),
): boolean {
  if (m.bodyText.includes('isStaffOrigin(')) return true;
  if (seen.has(m.name)) return false;
  seen.add(m.name);
  return [...m.bodyText.matchAll(/\bthis\.([A-Za-z0-9_]+)\s*\(/g)].some(([, c]) => {
    const h = c === undefined ? undefined : methods.get(c);
    return h !== undefined && reachesStaffOrigin(h, methods, seen);
  });
}

type OriginKind = 'direct' | 'leave-guard' | 'private-view';
type StaffControllerEntry = readonly [
  className: string,
  moduleFile: string,
  staff: readonly string[],
  kind: OriginKind,
  signOut?: readonly string[],
];

const STAFF_CONTROLLER_SPECS: readonly StaffControllerEntry[] = [
  ['StaffPinController', 'identity/http/staff-pin.controller.ts', ['signIn', 'change'], 'direct'],
  [
    'StaffPinResetController',
    'identity/http/staff-pin-reset.controller.ts',
    ['request', 'reset'],
    'direct',
  ],
  [
    'StaffOtpController',
    'identity/http/staff-otp.controller.ts',
    ['request', 'verify', 'session'],
    'direct',
    ['signOut'],
  ],
  [
    'PrivateViewController',
    'identity/http/private-view.controller.ts',
    ['open', 'touch', 'close'],
    'direct',
  ],
  ['ClockByCardController', 'staff/http/clock-by-card.controller.ts', ['submit'], 'direct'],
  [
    'OwnLeaveController',
    'staff/http/own-leave.controller.ts',
    ['request', 'cancelRequest', 'list'],
    'leave-guard',
  ],
  ['OwnAttendanceController', 'staff/http/own-attendance.controller.ts', ['read'], 'private-view'],
  [
    'OwnCommissionEstimateController',
    'commissions/http/own-commission-estimate.controller.ts',
    ['estimate'],
    'private-view',
  ],
  [
    'OwnWorkController',
    'orders/http/own-work.controller.ts',
    ['tips', 'serviceLines'],
    'private-view',
  ],
];

function discoverRegisteredStaffInventory(): Record<
  string,
  { readonly staff: string[]; readonly signOut: string[] }
> {
  const discovered: Record<string, { readonly staff: string[]; readonly signOut: string[] }> = {};
  for (const controller of API_CONTROLLERS) {
    const seen = new Set<string>();
    const staff: string[] = [];
    const signOut: string[] = [];
    for (
      let proto = controller.prototype as object | null;
      proto !== null && proto !== Object.prototype;
      proto = Object.getPrototypeOf(proto) as object | null
    ) {
      for (const key of Object.getOwnPropertyNames(proto)) {
        if (key === 'constructor' || seen.has(key)) continue;
        seen.add(key);
        const fn = Object.getOwnPropertyDescriptor(proto, key)?.value as unknown;
        if (typeof fn !== 'function' || Reflect.getMetadata(PATH_METADATA, fn) === undefined)
          continue;
        if (Reflect.getMetadata(STAFF_ROUTE, fn) !== undefined) staff.push(key);
        if (Reflect.getMetadata(SIGN_OUT_ROUTE, fn) === 'staff') signOut.push(key);
      }
    }
    if (staff.length > 0 || signOut.length > 0) {
      discovered[controller.name] = { staff: staff.sort(), signOut: signOut.sort() };
    }
  }
  return discovered;
}

function verifyStaffController(apiSrcRoot: string, entry: StaffControllerEntry): void {
  const [, moduleFile, staff, kind] = entry;
  const source = readFileSync(join(apiSrcRoot, 'src/modules', moduleFile), 'utf8');
  expect(source).not.toMatch(/headers\.origin\s*[!=]==?/);
  const { classDecorators, methods } = classInfoOf(source);
  if (kind === 'leave-guard') {
    expect(classDecorators).toMatch(/UseGuards\(\s*StaffLeaveGuard\b/);
    return;
  }
  for (const name of staff) {
    const handler = methods.get(name);
    expect(handler, `${moduleFile}#${name}`).toBeDefined();
    if (handler === undefined) continue;
    if (kind === 'direct') {
      expect(reachesStaffOrigin(handler, methods), `${moduleFile}#${name}`).toBe(true);
    } else {
      expect(handler.decorators, `${moduleFile}#${name}`).toMatch(/@PrivateViewRoute\(/);
    }
  }
}

describe('every staff route handler checks Origin exclusively through isStaffOrigin (#666)', () => {
  const apiSrcRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');

  it('every API_CONTROLLERS staff or staff-sign-out route appears in STAFF_CONTROLLER_SPECS', () => {
    const expected = Object.fromEntries(
      STAFF_CONTROLLER_SPECS.map(([className, , staff, , signOut]) => [
        className,
        { staff: [...staff].sort(), signOut: [...(signOut ?? [])].sort() },
      ]),
    );
    expect(discoverRegisteredStaffInventory()).toEqual(expected);
  });

  it.each(STAFF_CONTROLLER_SPECS.map((entry) => ({ name: entry[0], entry })))(
    '$name enforces isStaffOrigin on all handlers',
    ({ entry }) => {
      verifyStaffController(apiSrcRoot, entry);
    },
  );

  it('staff guards check Origin through isStaffOrigin without direct equality on staff routes', () => {
    for (const rel of [
      'src/modules/staff/http/staff-leave.guard.ts',
      'src/shared/private-view.guard.ts',
    ]) {
      const source = readFileSync(join(apiSrcRoot, rel), 'utf8');
      expect(source).not.toMatch(/headers\.origin\s*[!=]==?/);
      expect(source).toContain('isStaffOrigin(');
    }
    expect(readFileSync(join(apiSrcRoot, 'src/shared/sign-out.guard.ts'), 'utf8')).toMatch(
      /kind === 'staff'\s*\?\s*isStaffOrigin\(/,
    );
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
