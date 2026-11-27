import { systemUuidV7 } from '@pospay/ids';
import { afterAll, beforeAll, expect, it } from 'vitest';

import {
  staffAccessFixture,
  systemRoleId,
  type Fixture,
} from '../../../../test/staff-access.fixture.ts';

// إيميل الاستعادة الاختياري للموظف (spec 079 PR-c1): بيتطبّع ويتفرد داخل الشركة، وبيرجع من قراءة
// التفاصيل بس، ومش بيدخل سجل التدقيق ولا قوائم الموظفين.
const ids = systemUuidV7();
let f: Fixture;
let number = 900;

beforeAll(async () => {
  f = await staffAccessFixture({});
});
afterAll(async () => {
  await f?.db.close();
  await f?.h.close();
});

const base = () => `/v1/businesses/${f.business}/employees`;
const body = (extra: Record<string, unknown> = {}) => ({
  name_en: `Recovery ${(number += 1)}`,
  primary_branch_id: f.salmiya,
  role_code: 'staff',
  hire_date: '2026-01-01',
  ...extra,
});
const create = (extra: Record<string, unknown> = {}) =>
  f.h.send('POST', base(), { cookie: f.ownerCookie, company: f.company, body: body(extra) });

it('stores a normalized address and never returns it from the create answer or the list', async () => {
  const created = await create({ recovery_email: 'Mixed.Case@Example.Test' });
  expect(created.status).toBe(201);
  const id = created.body['id'] as string;
  const [stored] = await f.h.owner`SELECT recovery_email FROM employees WHERE id=${id}`;
  expect(stored?.['recovery_email']).toBe('mixed.case@example.test');
  const [audit] = await f.h.owner`SELECT after FROM audit_log
    WHERE entity_id=${id} AND action='created'`;
  expect(audit?.['after']).toMatchObject({ recovery_email: 'SET' });
  expect(JSON.stringify(audit)).not.toContain('example.test');
  expect(created.text).not.toContain('example.test');
  const list = await f.h.send('GET', base(), { cookie: f.ownerCookie, company: f.company });
  expect(list.text).not.toContain('example.test');
});

it('refuses the same address for a second employee of the company, whatever the case', async () => {
  expect((await create({ recovery_email: 'taken@example.test' })).status).toBe(201);
  const second = await create({ recovery_email: 'TAKEN@example.test' });
  expect(second.status).toBe(409);
  expect(second.body['code']).toBe('EMPLOYEE_RECOVERY_EMAIL_TAKEN');
  expect((await create({ recovery_email: 'not an email' })).status).toBe(400);
});

it('edits through the detail read: set, keep when omitted, clear with null, duplicate refused', async () => {
  const created = await create();
  const id = created.body['id'] as string;
  const detail = async () =>
    (await f.h.send('GET', `${base()}/${id}`, { cookie: f.ownerCookie, company: f.company })).body;
  expect((await detail())['recovery_email']).toBeNull();
  const edit = (extra: Record<string, unknown>) =>
    f.h.send('PATCH', `${base()}/${id}`, {
      cookie: f.ownerCookie,
      company: f.company,
      body: {
        ...body(),
        name_en: created.body['name_en'],
        expected_revision: 1,
        branch_ids: [f.salmiya],
        branch_effective_date: '2026-01-01',
        ...extra,
      },
    });
  const set = await edit({ recovery_email: 'Edited@Example.Test' });
  expect(set.status).toBe(200);
  expect((await detail())['recovery_email']).toBe('edited@example.test');
  const keep = await edit({ expected_revision: (await detail())['revision'] });
  expect(keep.status).toBe(200);
  expect((await detail())['recovery_email']).toBe('edited@example.test');
  const replaced = await edit({
    expected_revision: (await detail())['revision'],
    recovery_email: 'Replaced@Example.Test',
  });
  expect(replaced.status).toBe(200);
  expect((await detail())['recovery_email']).toBe('replaced@example.test');
  const clash = await edit({
    expected_revision: (await detail())['revision'],
    recovery_email: 'taken@example.test',
  });
  expect(clash.status).toBe(409);
  const cleared = await edit({
    expected_revision: (await detail())['revision'],
    recovery_email: null,
  });
  expect(cleared.status).toBe(200);
  expect((await detail())['recovery_email']).toBeNull();
  const auditRows = await f.h.owner`SELECT before, after FROM audit_log
    WHERE entity_id=${id} AND action='updated' ORDER BY id`;
  expect(auditRows.at(-2)?.['before']).toMatchObject({ recovery_email: 'SET' });
  expect(auditRows.at(-2)?.['after']).toMatchObject({ recovery_email: 'CHANGED' });
  expect(auditRows.at(-1)?.['before']).toMatchObject({ recovery_email: 'SET' });
  expect(auditRows.at(-1)?.['after']).toMatchObject({ recovery_email: null });
  const audits = JSON.stringify(auditRows);
  expect(audits).not.toContain('example.test');
});

async function generalManagerCookie() {
  const cookie = await f.h.signedInOperator('gm-recovery@example.test');
  const [gmUser] = await f.h.owner`SELECT id FROM "user" WHERE email='gm-recovery@example.test'`;
  await f.h
    .owner`INSERT INTO memberships(company_id,id,user_id,role_id,role_owner_key,scope_type,scope_id)
    VALUES (${f.company},${ids.newId()},${gmUser?.['id'] as string},${systemRoleId('general_manager')},'global','COMPANY',${f.company})`;
  return cookie;
}

it('requires manage:staff-access:branch to set, change, or clear recovery_email', async () => {
  const gmCookie = await generalManagerCookie();
  const patch = (cookie: string, employeeId: string, extra: Record<string, unknown>) =>
    f.h.send('PATCH', `${base()}/${employeeId}`, {
      cookie,
      company: f.company,
      body: { ...body(), branch_ids: [f.salmiya], branch_effective_date: '2026-01-01', ...extra },
    });

  const deniedCreate = await f.h.send('POST', base(), {
    cookie: gmCookie,
    company: f.company,
    body: body({ recovery_email: 'gm-hijack@example.test' }),
  });
  expect(deniedCreate.status).toBe(403);
  expect(deniedCreate.body['code']).toBe('FORBIDDEN');

  const plain = await f.h.send('POST', base(), {
    cookie: gmCookie,
    company: f.company,
    body: body(),
  });
  expect(plain.status).toBe(201);
  const id = plain.body['id'] as string;
  const name_en = plain.body['name_en'];

  expect(
    (
      await patch(f.ownerCookie, id, {
        name_en,
        expected_revision: 1,
        recovery_email: 'owner-set@example.test',
      })
    ).status,
  ).toBe(200);
  expect(
    (await patch(gmCookie, id, { name_en: 'GM Rename Allowed', expected_revision: 2 })).status,
  ).toBe(200);
  for (const recovery_email of ['gm-override@example.test', null]) {
    const refused = await patch(gmCookie, id, {
      name_en: 'GM Rename Allowed',
      expected_revision: 3,
      recovery_email,
    });
    expect(refused.status).toBe(403);
    expect(refused.body['code']).toBe('FORBIDDEN');
  }
  const [row] = await f.h.owner`SELECT recovery_email FROM employees WHERE id=${id}`;
  expect(row?.['recovery_email']).toBe('owner-set@example.test');
});
