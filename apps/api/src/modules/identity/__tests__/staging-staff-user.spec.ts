import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, expect, it } from 'vitest';

import { main } from '../../../../scripts/staging-staff-user.ts';
import { startHarness, type Harness } from '../../../../test/harness.ts';
import { origin, paired } from '../../../../test/staff-otp-harness.ts';

const phone = `+9655${'1'.padStart(7, '0')}`;
const pin = String(58).padStart(4, '0');
let h: Harness;
let manager: string;
let company: string;
let business: string;
let branch: string;
let employee: string;
let device: Awaited<ReturnType<typeof paired>>;

beforeAll(async () => {
  h = await startHarness({ staffOrigin: origin });
  manager = await h.signedInOperator(`${'staging-manager'}@synthetic.invalid`);
  company = await h.onboard(manager, 'Synthetic staging staff');
  business = (
    await h.send('POST', '/v1/businesses', {
      cookie: manager,
      company,
      key: 'staging-staff-business',
      body: { vertical_type: 'salon', name_en: 'Synthetic staging' },
    })
  ).body['id'] as string;
  branch = (
    await h.send('POST', `/v1/businesses/${business}/branches`, {
      cookie: manager,
      company,
      key: 'staging-staff-branch',
      body: { name_en: 'Synthetic staging' },
    })
  ).body['id'] as string;
  device = await paired(h, manager, company, branch);
  const created = await h.send('POST', `/v1/businesses/${business}/employees`, {
    cookie: manager,
    company,
    body: {
      primary_branch_id: branch,
      name_en: 'Synthetic staging employee',
      role_code: 'staff',
      hire_date: '2026-01-01',
    },
  });
  expect(created.status).toBe(201);
  employee = created.body['id'] as string;
});

afterAll(async () => {
  await h?.close();
});

function argv(target = 'staging'): string[] {
  return [
    '--target',
    target,
    '--company',
    company,
    '--business',
    business,
    '--branch',
    branch,
    '--employee',
    employee,
    '--phone',
    phone,
    '--name',
    'Synthetic staging staff',
    '--operator',
    'synthetic.operator',
  ];
}

function cliArgs(options: { phone?: string; branch?: string; employee?: 'drop' } = {}): string[] {
  const args = argv();
  if (options.phone !== undefined) args[args.indexOf('--phone') + 1] = options.phone;
  if (options.branch !== undefined) args[args.indexOf('--branch') + 1] = options.branch;
  if (options.employee === 'drop') {
    const index = args.indexOf('--employee');
    args.splice(index, 2);
  }
  return args;
}

function stagingEnv(): NodeJS.ProcessEnv {
  return {
    DEPLOY_ENV: 'staging',
    NODE_ENV: 'production',
    BETTER_AUTH_URL: 'https://api.staging.pospay.systems',
    COOKIE_DOMAIN: '.staging.pospay.systems',
    DATABASE_URL: h.urls.app,
    AUTH_DATABASE_URL: h.urls.auth,
    BETTER_AUTH_SECRET: 'synthetic'.repeat(8),
    AUTH_TRUSTED_ORIGINS: 'https://app.staging.pospay.systems,https://pos.staging.pospay.systems',
    STAFF_PHONE_OWNERSHIP_VERIFIED: 'true',
    STAFF_PHONE_BINDING_APPROVED: 'true',
  };
}

function stagingEnvWithout(key: string): NodeJS.ProcessEnv {
  const env = stagingEnv();
  delete env[key];
  return env;
}

function rowCounts() {
  return h.owner`SELECT
    (SELECT count(*) FROM "user") AS users,
    (SELECT count(*) FROM account) AS accounts,
    (SELECT count(*) FROM verification) AS verifications,
    (SELECT count(*) FROM memberships) AS memberships,
    (SELECT count(*) FROM employees) AS employees,
    (SELECT count(*) FROM audit_log) AS audits,
    (SELECT count(*) FROM platform_audit_log) AS platform_audits`;
}

it('provisions once, supports PIN sign-in, and preserves all rows and the session on rerun', async () => {
  const first: string[] = [];
  expect(await main(argv(), stagingEnv(), (line) => first.push(line))).toBe(0);
  const match = /^user: created ([0-9a-f-]{36})$/.exec(first[0] ?? '');
  expect(match).not.toBeNull();
  const userId = match?.[1] ?? '';
  expect(first).toEqual([
    `user: created ${userId}`,
    'phone binding: approved',
    'membership: created',
    'employee link: linked',
    `next: set the PIN with POST /v1/staff-pins/reset for user ${userId}`,
  ]);
  expect(
    (
      await h.send('POST', '/v1/staff-pins/reset', {
        cookie: manager,
        company,
        body: { user_id: userId, pin },
      })
    ).status,
  ).toBe(204);
  const signedIn = await h.app.inject({
    method: 'POST',
    url: '/v1/devices/me/staff-pin/sign-in',
    headers: { authorization: `Device ${device.token}`, origin },
    payload: { phone, pin },
  });
  expect(signedIn.statusCode).toBe(200);
  expect(signedIn.json().user_id).toBe(userId);
  const sessions =
    await h.owner`SELECT id FROM session WHERE user_id=${userId} AND purpose='STAFF_POS'`;
  expect(sessions).toHaveLength(1);
  const before = await rowCounts();
  const second: string[] = [];
  expect(await main(argv(), stagingEnv(), (line) => second.push(line))).toBe(0);
  expect(second).toEqual([
    `user: unchanged ${userId}`,
    'phone binding: unchanged',
    'membership: unchanged',
    'employee link: unchanged',
    `next: set the PIN with POST /v1/staff-pins/reset for user ${userId}`,
  ]);
  expect(await rowCounts()).toEqual(before);
  expect(
    await h.owner`SELECT id FROM session WHERE user_id=${userId} AND purpose='STAFF_POS'`,
  ).toEqual(sessions);
  const refusal: string[] = [];
  expect(await main(argv('production'), stagingEnv(), (line) => refusal.push(line))).toBe(1);
  expect(refusal).toEqual(['refused: not staging']);
  expect(await rowCounts()).toEqual(before);
  const output = [...first, ...second, ...refusal].join('\n');
  expect(output).not.toContain(phone);
  expect(output).not.toContain('@staging.pospay.invalid');
}, 60_000);

it('refuses a wrong branch id without burning the phone, and the corrected rerun reuses the user', async () => {
  const freshPhone = `+9655${'2'.padStart(7, '0')}`;
  const refused: string[] = [];
  expect(
    await main(
      cliArgs({ phone: freshPhone, branch: randomUUID(), employee: 'drop' }),
      stagingEnv(),
      (line) => refused.push(line),
    ),
  ).toBe(1);
  const userId = /^user: created ([0-9a-f-]{36})$/.exec(refused[0] ?? '')?.[1] ?? '';
  expect(userId).not.toBe('');
  expect(refused.slice(1)).toEqual(['phone binding: approved', 'refused: TARGET_SCOPE_REFUSED']);
  const corrected: string[] = [];
  expect(
    await main(
      cliArgs({ phone: freshPhone, employee: 'drop' }),
      stagingEnv(),
      (line) => corrected.push(line),
    ),
  ).toBe(0);
  expect(corrected).toEqual([
    `user: unchanged ${userId}`,
    'phone binding: unchanged',
    'membership: created',
    'employee link: skipped',
    `next: set the PIN with POST /v1/staff-pins/reset for user ${userId}`,
  ]);
}, 60_000);

it('refuses a phone owned by another user and creates no user', async () => {
  const conflictPhone = `+9655${'3'.padStart(7, '0')}`;
  const owners = await h.owner`SELECT id FROM "user" WHERE email=${'staging-manager@synthetic.invalid'}`;
  const ownerId = owners[0]?.id ?? '';
  expect(ownerId).not.toBe('');
  await h.owner`UPDATE "user" SET phone_number=${conflictPhone} WHERE id=${ownerId}`;
  const before = await rowCounts();
  const refused: string[] = [];
  expect(
    await main(cliArgs({ phone: conflictPhone }), stagingEnv(), (line) => refused.push(line)),
  ).toBe(1);
  expect(refused).toEqual(['refused: identity conflict']);
  expect(await rowCounts()).toEqual(before);
}, 60_000);

it('refuses a malformed phone before touching the database', async () => {
  const before = await rowCounts();
  const refused: string[] = [];
  expect(
    await main(cliArgs({ phone: 'not-a-phone' }), stagingEnv(), (line) => refused.push(line)),
  ).toBe(1);
  expect(refused).toEqual(['refused: bad input']);
  expect(await rowCounts()).toEqual(before);
}, 60_000);

it('refuses to run without the phone ownership acknowledgement', async () => {
  const before = await rowCounts();
  const refused: string[] = [];
  expect(
    await main(
      argv(),
      stagingEnvWithout('STAFF_PHONE_OWNERSHIP_VERIFIED'),
      (line) => refused.push(line),
    ),
  ).toBe(1);
  expect(refused).toEqual(['refused: phone ownership not acknowledged']);
  expect(await rowCounts()).toEqual(before);
}, 60_000);
