import { afterAll, afterEach, beforeAll, expect, it } from 'vitest';
import { createAccessReader } from '../persistence/access-reader.ts';
import { AuthorizeRequest } from '../use-cases/authorize-request/authorize-request.ts';
import {
  newHeldMember,
  permissionFixture,
  revoke,
  save,
  seedOverride,
  type PermissionFixture,
} from './permissions-screen.fixture.ts';

const permission_code = 'manage:memberships:company';
const changes = { permission_code };
let f: PermissionFixture;
let touched: string[] = [];
beforeAll(async () => {
  f = await permissionFixture();
  await seedOverride(f, f.managerMember, changes);
});
afterEach(async () => {
  for (const member of touched)
    await f.h.owner`UPDATE permission_overrides SET expires_at = now()
      WHERE company_id = ${f.company} AND membership_id = ${member}`;
  touched = [];
});
afterAll(async () => {
  await f?.db.close();
  await f?.h.close();
});

async function sibling(
  holder: { userId: string } | { employeeId: string },
  code = 'synthetic_viewer',
) {
  const member = await newHeldMember(f, holder, code);
  touched.push(member);
  return member;
}
function refusal(response: Awaited<ReturnType<typeof save>>, code: string) {
  expect(response.status).toBe(403);
  expect(response.body['code']).toBe(code);
  expect(response.body['message_ar']).toEqual(expect.any(String));
  expect(response.body['message_en']).toEqual(expect.any(String));
}
async function managementAccess() {
  const authorize = new AuthorizeRequest(createAccessReader(f.db));
  return authorize.execute({
    userId: f.userId,
    requestedCompany: f.company,
    permission: permission_code,
  });
}
async function attempt(operation: string, member: string, cookie = f.managerCookie) {
  if (operation === 'DENY') return save(f, member, { ...changes, effect: 'DENY' }, cookie);
  const id = await seedOverride(f, member, changes);
  const response =
    operation === 'REPLACE'
      ? await save(f, member, changes, cookie)
      : await revoke(f, member, id, cookie);
  const [row] = await f.h.owner`SELECT expires_at FROM permission_overrides
    WHERE company_id = ${f.company} AND id = ${id}`;
  expect(row?.['expires_at']).toBeNull();
  return response;
}

it.each([
  ['user', 'DENY'],
  ['user', 'REPLACE'],
  ['user', 'REVOKE'],
  ['employee', 'DENY'],
  ['employee', 'REPLACE'],
  ['employee', 'REVOKE'],
])(
  'protects an owner %s through a second custom-role membership on %s',
  async (type, operation) => {
    const holder = type === 'user' ? { userId: f.userId } : { employeeId: f.ids.newId() };
    if (type === 'employee') await sibling(holder, 'owner');
    const member = await sibling(holder);
    expect(await managementAccess()).not.toBeNull();
    const priorVersion = await f.h.redis.get(`identity:grants:${f.company}:version`);
    const [before] = await f.h
      .owner`SELECT count(*) AS n FROM audit_log WHERE company_id = ${f.company}`;
    refusal(await attempt(operation, member), 'PERMISSION_OWNER_PROTECTED');
    expect(await managementAccess()).not.toBeNull();
    const [after] = await f.h
      .owner`SELECT count(*) AS n FROM audit_log WHERE company_id = ${f.company}`;
    expect(after?.['n']).toBe(before?.['n']);
    expect(await f.h.redis.get(`identity:grants:${f.company}:version`)).toBe(priorVersion);
  },
);

it.each(['DENY', 'REPLACE', 'REVOKE'])(
  'refuses self %s through another user membership',
  async (operation) => {
    const member = await sibling({ userId: f.managerId });
    refusal(await attempt(operation, member), 'PERMISSION_SELF_EDIT');
  },
);

it.each(['user', 'employee'])(
  'allows all lifecycle operations for a non-owner %s with two memberships',
  async (type) => {
    const holder = type === 'user' ? { userId: f.managerId } : { employeeId: f.ids.newId() };
    await sibling(holder);
    const member = await sibling(holder);
    expect((await save(f, member, changes)).status).toBe(201);
    const replaced = await save(f, member, { ...changes, effect: 'DENY' });
    expect(replaced.status).toBe(201);
    expect((await revoke(f, member, replaced.body['id'] as string)).status).toBe(200);
  },
);

it('allows a new ALLOW on an owner sibling without replacing one', async () => {
  const member = await sibling({ userId: f.userId });
  expect((await save(f, member, changes, f.managerCookie)).status).toBe(201);
  expect(await managementAccess()).not.toBeNull();
});

it('does not protect a holder because of an inactive or cross-company owner membership', async () => {
  const holder = { employeeId: f.ids.newId() };
  const ended = await sibling(holder, 'owner');
  await f.h.owner`UPDATE memberships SET starts_at='2020-01-01', ends_at='2021-01-01'
    WHERE company_id = ${f.company} AND id = ${ended}`;
  await newHeldMember(f, holder, 'owner', f.otherCompany);
  const member = await sibling(holder);
  expect((await save(f, member, { ...changes, effect: 'DENY' })).status).toBe(201);
});
