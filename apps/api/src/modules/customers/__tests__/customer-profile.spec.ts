import { Writable } from 'node:stream';

import { customer, customerProfile, findOrCreateCustomerInput } from '@pospay/contracts';
import { afterAll, beforeAll, expect, it } from 'vitest';

import { startHarness, type Harness } from '../../../../test/harness.ts';

const BUSINESS_A = '01920000-0000-7000-8000-00000000e001';
const BUSINESS_B = '01920000-0000-7000-8000-00000000e002';
const BRANCH_A = '01920000-0000-7000-8000-00000000e003';
const COMPANY_PATH = '/v1/customers/find-or-create';
const BUSINESS_PATH = `/v1/businesses/${BUSINESS_A}/customers/find-or-create`;
const BRANCH_PATH = `/v1/branches/${BRANCH_A}/customers/find-or-create`;
const NOTE = 'Prefers the window seat';
const payload = {
  phone: { calling_code: '1', national_number: '2025550131' },
  name: 'Profile A',
  locale: 'ar' as const,
};
let h: Harness;
let cookieA: string;
let cookieB: string;
let A: string;
let B: string;
let logs = '';

beforeAll(async () => {
  h = await startHarness({
    logs: new Writable({
      write(chunk, _encoding, done) {
        logs += String(chunk);
        done();
      },
    }),
  });
  cookieA = await h.signedInOperator('profile-a@example.test');
  cookieB = await h.signedInOperator('profile-b@example.test');
  A = await h.onboard(cookieA, 'Profile Company A');
  B = await h.onboard(cookieB, 'Profile Company B');
  await h.owner`INSERT INTO businesses (company_id, id, name_en, name_ar, vertical_type)
    VALUES (${A}, ${BUSINESS_A}, 'Business A', 'نشاط أ', 'salon'),
           (${A}, ${BUSINESS_B}, 'Business B', 'نشاط ب', 'salon')`;
  await h.owner`INSERT INTO branches (company_id, id, business_id, name_en)
    VALUES (${A}, ${BRANCH_A}, ${BUSINESS_A}, 'Branch of business A')`;
  for (const code of [
    'create:customers:company',
    'create:customers:business',
    'create:customers:branch',
  ])
    await h.owner`INSERT INTO permission_overrides (company_id, id, membership_id, permission_code, effect, scope_type, scope_id, reason, granted_by)
      SELECT company_id, gen_random_uuid(), id, ${code}, 'ALLOW', 'COMPANY', company_id, 'Synthetic test grant', user_id
      FROM memberships WHERE company_id = ${A}`;
  for (const code of [
    'create:customers:company',
    'create:customers:business',
    'create:customers:branch',
  ])
    await h.owner`INSERT INTO permission_overrides (company_id, id, membership_id, permission_code, effect, scope_type, scope_id, reason, granted_by)
      SELECT company_id, gen_random_uuid(), id, ${code}, 'ALLOW', 'COMPANY', company_id, 'Synthetic test grant', user_id
      FROM memberships WHERE company_id = ${B}`;
});

afterAll(async () => {
  await h.close();
});

const send = (path: string, body: object, cookie = cookieA, company = A) =>
  h.send('POST', path, { cookie, company, body });

it('creates through the business route with every field and a note', async () => {
  const result = await send(BUSINESS_PATH, {
    ...payload,
    gender: 'female',
    birthday: { day: 5, month: 3, year: 1990 },
    email: 'profile@example.test',
    note: NOTE,
  });
  expect(result.status).toBe(200);
  const body = customer.parse(result.body);
  expect(Object.keys(body).sort()).toEqual(['id', 'locale', 'name', 'opted_out', 'phone']);
  const row = await h.owner`SELECT gender, birth_day, birth_month, birth_year, email
    FROM customers WHERE company_id = ${A} AND id = ${body.id}`;
  expect(row).toEqual([
    {
      gender: 'female',
      birth_day: 5,
      birth_month: 3,
      birth_year: 1990,
      email: 'profile@example.test',
    },
  ]);
  const notes = await h.owner`SELECT business_id, note FROM customer_notes
    WHERE company_id = ${A} AND customer_id = ${body.id}`;
  expect(notes).toEqual([{ business_id: BUSINESS_A, note: NOTE }]);
  const audit = await h.owner`SELECT after FROM audit_log
    WHERE company_id = ${A} AND entity_id = ${body.id} AND action = 'created'`;
  expect(Object.keys((audit[0]?.['after'] ?? {}) as object).sort()).toEqual([
    'id',
    'locale',
    'name',
    'opted_out',
    'phone',
  ]);
});

it('creates through the branch route and the note belongs to the branch business', async () => {
  const result = await send(BRANCH_PATH, {
    ...payload,
    phone: { calling_code: '1', national_number: '2025550132' },
    note: NOTE,
  });
  expect(result.status).toBe(200);
  const body = customer.parse(result.body);
  const notes = await h.owner`SELECT business_id, note FROM customer_notes
    WHERE company_id = ${A} AND customer_id = ${body.id}`;
  expect(notes).toEqual([{ business_id: BUSINESS_A, note: NOTE }]);
});

it('the company route takes the scalar fields and refuses a note', async () => {
  const created = await send(COMPANY_PATH, {
    ...payload,
    phone: { calling_code: '1', national_number: '2025550133' },
    gender: 'male',
    birthday: { day: 5, month: 3 },
    email: 'company@example.test',
  });
  expect(created.status).toBe(200);
  const body = customer.parse(created.body);
  const row = await h.owner`SELECT gender, birth_day, birth_month, birth_year, email
    FROM customers WHERE company_id = ${A} AND id = ${body.id}`;
  expect(row).toEqual([
    {
      gender: 'male',
      birth_day: 5,
      birth_month: 3,
      birth_year: null,
      email: 'company@example.test',
    },
  ]);

  const notesBefore = await h.owner`SELECT 1 FROM customer_notes WHERE company_id = ${A}`;
  const refused = await send(COMPANY_PATH, {
    ...payload,
    phone: { calling_code: '1', national_number: '2025550134' },
    note: NOTE,
  });
  expect(refused.status).toBe(400);
  expect(refused.body).toMatchObject({ code: 'VALIDATION_FAILED' });
  expect(refused.body).not.toHaveProperty('details');
  expect(refused.text).not.toContain(NOTE);
  expect(await h.owner`SELECT 1 FROM customer_notes WHERE company_id = ${A}`).toEqual(notesBefore);
  expect(
    await h.owner`SELECT 1 FROM customers WHERE company_id = ${A} AND phone = '+12025550134'`,
  ).toHaveLength(0);
});

it('an omitted gender is stored as NULL', async () => {
  const result = await send(COMPANY_PATH, {
    ...payload,
    phone: { calling_code: '1', national_number: '2025550135' },
  });
  expect(result.status).toBe(200);
  const body = customer.parse(result.body);
  expect(
    await h.owner`SELECT gender FROM customers WHERE company_id = ${A} AND id = ${body.id}`,
  ).toEqual([{ gender: null }]);
});

it.each([
  ['a gender that is not stored', { gender: 'ذكر' }],
  ['a day that does not exist', { birthday: { day: 30, month: 2 } }],
  ['an email without a dot', { email: 'profile@example' }],
  ['a note with a NUL', { note: `a${String.fromCharCode(0)}b` }],
])('refuses %s with VALIDATION_FAILED and writes nothing', async (_case, extra) => {
  const before = await h.owner`SELECT 1 FROM customers WHERE company_id = ${A}`;
  const notesBefore = await h.owner`SELECT 1 FROM customer_notes WHERE company_id = ${A}`;
  const result = await send(COMPANY_PATH, {
    ...payload,
    phone: { calling_code: '1', national_number: '2025550136' },
    ...extra,
  });
  expect(result.status).toBe(400);
  expect(result.body).toMatchObject({ code: 'VALIDATION_FAILED' });
  expect(result.body).not.toHaveProperty('details');
  expect(result.text).not.toContain('2025550136');
  expect(logs).not.toContain('2025550136');
  expect(await h.owner`SELECT 1 FROM customers WHERE company_id = ${A}`).toEqual(before);
  expect(await h.owner`SELECT 1 FROM customer_notes WHERE company_id = ${A}`).toEqual(notesBefore);
});

it('an existing customer keeps everything: no field, no note and no audit', async () => {
  const existing = customer.parse(
    (
      await send(COMPANY_PATH, {
        ...payload,
        phone: { calling_code: '1', national_number: '2025550137' },
      })
    ).body,
  );
  const auditsBefore = await h.owner`SELECT 1 FROM audit_log WHERE company_id = ${A}`;
  const result = await send(BUSINESS_PATH, {
    ...payload,
    phone: { calling_code: '1', national_number: '0002025550137' },
    name: 'Do not overwrite',
    gender: 'female',
    birthday: { day: 5, month: 3, year: 1990 },
    email: 'later@example.test',
    note: NOTE,
  });
  expect(result.status).toBe(200);
  expect(customer.parse(result.body)).toEqual(existing);
  const row = await h.owner`SELECT name, gender, birth_day, birth_month, birth_year, email
    FROM customers WHERE company_id = ${A} AND id = ${existing.id}`;
  expect(row).toEqual([
    {
      name: 'Profile A',
      gender: null,
      birth_day: null,
      birth_month: null,
      birth_year: null,
      email: null,
    },
  ]);
  expect(
    await h.owner`SELECT 1 FROM customer_notes WHERE company_id = ${A} AND customer_id = ${existing.id}`,
  ).toHaveLength(0);
  expect(await h.owner`SELECT 1 FROM audit_log WHERE company_id = ${A}`).toEqual(auditsBefore);
});

it('the profile shows the notes of every business of the company with their names', async () => {
  const created = customer.parse(
    (
      await send(BUSINESS_PATH, {
        ...payload,
        phone: { calling_code: '1', national_number: '2025550138' },
        gender: 'female',
        birthday: { day: 5, month: 3, year: 1990 },
        email: 'card@example.test',
        note: NOTE,
      })
    ).body,
  );
  await h.owner`INSERT INTO customer_notes (company_id, customer_id, business_id, note, created_at)
    VALUES (${A}, ${created.id}, ${BUSINESS_B}, 'Note of the second business', now() + interval '1 minute')`;
  for (const path of [
    `/v1/customers/${created.id}/profile`,
    `/v1/businesses/${BUSINESS_A}/customers/${created.id}/profile`,
    `/v1/branches/${BRANCH_A}/customers/${created.id}/profile`,
  ]) {
    const result = await h.send('GET', path, { cookie: cookieA, company: A });
    expect(result.status).toBe(200);
    const profile = customerProfile.parse(result.body);
    expect(profile).toMatchObject({
      id: created.id,
      name: 'Profile A',
      phone: '***138',
      gender: 'female',
      birthday: { day: 5, month: 3, year: 1990 },
      email: 'card@example.test',
    });
    expect(profile.notes.map((note) => note.business_name_en)).toEqual([
      'Business A',
      'Business B',
    ]);
    expect(profile.notes.map((note) => note.business_id)).toEqual([BUSINESS_A, BUSINESS_B]);
    expect(profile.notes.map((note) => note.note)).toEqual([NOTE, 'Note of the second business']);
    expect(result.text).not.toContain('+12025550138');
    expect(logs).not.toContain('+12025550138');
  }
});

it('the profile of another tenant is NOT_FOUND', async () => {
  const other = customer.parse(
    (
      await h.send('POST', COMPANY_PATH, {
        cookie: cookieB,
        company: B,
        body: { ...payload, phone: { calling_code: '1', national_number: '2025550139' } },
      })
    ).body,
  );
  const result = await h.send('GET', `/v1/customers/${other.id}/profile`, {
    cookie: cookieA,
    company: A,
  });
  expect(result.status).toBe(404);
  expect(result.body).toMatchObject({ code: 'NOT_FOUND' });
});

it('R-2 the old admin body creates a customer through the branch route', async () => {
  const old = findOrCreateCustomerInput.parse({
    phone: { calling_code: '1', national_number: '2025550140' },
    name: 'Old admin body',
    locale: 'ar',
  });
  const result = await send(BRANCH_PATH, old);
  expect(result.status).toBe(200);
  const body = customer.parse(result.body);
  expect(body.name).toBe('Old admin body');
  expect(
    await h.owner`SELECT gender, birth_day, birth_month, birth_year, email
      FROM customers WHERE company_id = ${A} AND id = ${body.id}`,
  ).toEqual([{ gender: null, birth_day: null, birth_month: null, birth_year: null, email: null }]);
});

it('concurrent callers with different notes leave one customer, one note and one audit', async () => {
  const results = await Promise.all(
    Array.from({ length: 4 }, (_, index) =>
      send(BUSINESS_PATH, {
        ...payload,
        phone: { calling_code: '1', national_number: '2025550144' },
        name: `Concurrent ${index}`,
        locale: 'ar',
        note: `Note ${index}`,
      }),
    ),
  );
  expect(results.map((result) => result.status)).toEqual([200, 200, 200, 200]);
  const bodies = results.map((result) => customer.parse(result.body));
  expect(new Set(bodies.map((body) => body.id)).size).toBe(1);
  const id = bodies[0]?.id ?? '';
  const notes = await h.owner`SELECT business_id, note FROM customer_notes
    WHERE company_id = ${A} AND customer_id = ${id}`;
  expect(notes).toHaveLength(1);
  expect(notes[0]?.['business_id']).toBe(BUSINESS_A);
  const audits =
    await h.owner`SELECT id FROM audit_log WHERE company_id = ${A} AND entity_id = ${id}`;
  expect(audits).toHaveLength(1);
});

async function createCustomer(nationalNumber: string): Promise<string> {
  const result = await send(COMPANY_PATH, {
    ...payload,
    phone: { calling_code: '1', national_number: nationalNumber },
  });
  return customer.parse(result.body).id;
}

function profilePaths(customerId: string): string[] {
  return [
    `/v1/customers/${customerId}/profile`,
    `/v1/businesses/${BUSINESS_A}/customers/${customerId}/profile`,
    `/v1/branches/${BRANCH_A}/customers/${customerId}/profile`,
  ];
}

it('every profile route refuses a missing session', async () => {
  const id = await createCustomer('2025550141');
  for (const path of profilePaths(id)) {
    expect((await h.app.inject({ method: 'GET', url: path })).statusCode).toBe(401);
  }
});

it('every profile route refuses a caller without the permission and a foreign company', async () => {
  const id = await createCustomer('2025550142');
  const paths = profilePaths(id);
  const deniedCookie = await h.signedInOperator('profile-viewer@example.test');
  const [viewer] = await h.owner`SELECT id FROM "user" WHERE email='profile-viewer@example.test'`;
  await h.owner`INSERT INTO memberships(company_id,id,user_id,role_id,role_owner_key,scope_type,scope_id)
    VALUES (${A},'01920000-0000-7000-8000-000000009902',${viewer?.['id']},
      '01920000-0000-7000-8000-00000000010d','global','COMPANY',${A})`;
  for (const path of paths) {
    expect((await h.send('GET', path, { cookie: deniedCookie, company: A })).status).toBe(403);
  }
  for (const path of paths) {
    expect((await h.send('GET', path, { cookie: cookieA, company: B })).status).toBe(403);
  }
});

it('every profile route refuses a disabled feature', async () => {
  const id = await createCustomer('2025550143');
  const paths = profilePaths(id);
  const [row] = await h.owner`SELECT user_id FROM memberships WHERE company_id = ${A}`;
  await h.owner`INSERT INTO company_feature_overrides (company_id, flag, enabled, reason, set_by)
    VALUES (${A}, 'customers', false, 'Synthetic feature test', ${row?.['user_id']})
    ON CONFLICT (company_id, flag) DO UPDATE SET enabled = false, reason = 'Synthetic feature test'`;
  for (const path of paths) {
    expect((await h.send('GET', path, { cookie: cookieA, company: A })).body).toMatchObject({
      code: 'FEATURE_DISABLED',
    });
  }
  await h.owner`UPDATE company_feature_overrides SET enabled = true WHERE company_id = ${A} AND flag = 'customers'`;
  const restored = await h.send('GET', paths[0] ?? '', { cookie: cookieA, company: A });
  expect(restored.status).toBe(200);
});
