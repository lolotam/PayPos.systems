import { businessLogo, businessSettings, errorEnvelope } from '@pospay/contracts';
import { sql } from 'drizzle-orm';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';

import {
  newHeldMember,
  permissionFixture,
  seedOverride,
  type PermissionFixture,
} from '../../../../test/permissions-fixture.ts';
import { readBusinessIdentity } from '../persistence/read-business-identity.ts';
import { createSettingsTransactions } from '../persistence/settings-transactions.ts';
import { SetBusinessLogo } from '../use-cases/set-business-logo/set-business-logo.ts';
import {
  deviceToken,
  expectLogoRefusal,
  foreignBusinessId,
  insertLogoFile,
  logoAudits,
  logoEvents,
} from './set-business-logo.support.ts';

let f: PermissionFixture;

beforeAll(async () => {
  f = await permissionFixture();
});
afterAll(async () => {
  await f?.db.close();
  await f?.h.close();
});
beforeEach(async () => {
  await f.h.owner`UPDATE business_settings SET logo_file_id = NULL
    WHERE company_id = ${f.company} AND business_id = ${f.business}`;
  await f.h.redis.del(`settings:${f.company}:${f.business}:generation`);
});

const url = () => `/v1/businesses/${f.business}/settings/logo`;
const put = (body: object, cookie = f.cookie, company = f.company) =>
  f.h.app.inject({
    method: 'PUT',
    url: url(),
    headers: { cookie, 'x-company-id': company },
    payload: body,
  });

it('the owner binds a ready logo, audits the three columns, and emits the previous id', async () => {
  const id = await insertLogoFile(f);
  const beforeAudits = (await logoAudits(f)).length;
  const res = await put({ file_id: id });
  expect(res.statusCode).toBe(200);
  expect(businessLogo.parse(res.json())).toEqual({ logo_file_id: id });
  const read = await f.h.send('GET', `/v1/businesses/${f.business}/settings`, {
    cookie: f.cookie,
    company: f.company,
  });
  expect(businessSettings.parse(read.body).logo_file_id).toBe(id);
  const stored = await f.db.withTenant(
    f.company,
    (tx) => readBusinessIdentity(tx, f.company, f.business),
    { userId: f.userId },
  );
  expect(stored).toEqual({ official_name_ar: null, official_name_en: null, logo_file_id: id });
  const audits = await logoAudits(f);
  expect(audits).toHaveLength(beforeAudits + 1);
  expect(audits.at(-1)).toEqual({
    actor_user_id: f.userId,
    before: { official_name_ar: null, official_name_en: null, logo_file_id: null },
    after: { official_name_ar: null, official_name_en: null, logo_file_id: id },
  });
  expect(JSON.stringify(audits.at(-1))).not.toContain('storage');
  const events = await logoEvents(f);
  expect(events.at(-1)?.['payload']).toEqual({
    business_id: f.business,
    previous_file_id: null,
    file_id: id,
  });
  expect(JSON.stringify(events.at(-1)?.['payload'])).not.toContain('storage');
});

it('replaces the logo with the previous id and removes it with a null file id', async () => {
  const first = await insertLogoFile(f);
  const second = await insertLogoFile(f);
  expect((await put({ file_id: first })).statusCode).toBe(200);
  const replaced = await put({ file_id: second });
  expect(businessLogo.parse(replaced.json())).toEqual({ logo_file_id: second });
  expect((await logoEvents(f)).at(-1)?.['payload']).toEqual({
    business_id: f.business,
    previous_file_id: first,
    file_id: second,
  });
  const removed = await put({ file_id: null });
  expect(removed.statusCode).toBe(200);
  expect(businessLogo.parse(removed.json())).toEqual({ logo_file_id: null });
  expect((await logoEvents(f)).at(-1)?.['payload']).toEqual({
    business_id: f.business,
    previous_file_id: second,
    file_id: null,
  });
  const read = await f.h.send('GET', `/v1/businesses/${f.business}/settings`, {
    cookie: f.cookie,
    company: f.company,
  });
  expect(businessSettings.parse(read.body).logo_file_id).toBeNull();
});

it('rebinding the same file, in any letter case, and clearing an empty logo are no-ops', async () => {
  const id = await insertLogoFile(f);
  expect((await put({ file_id: id })).statusCode).toBe(200);
  const audits = (await logoAudits(f)).length;
  const events = (await logoEvents(f)).length;
  const again = await put({ file_id: id.toUpperCase() });
  expect(again.statusCode).toBe(200);
  expect(businessLogo.parse(again.json())).toEqual({ logo_file_id: id });
  const cleared = await put({ file_id: null });
  expect(cleared.statusCode).toBe(200);
  const empty = await put({ file_id: null });
  expect(businessLogo.parse(empty.json())).toEqual({ logo_file_id: null });
  expect(await logoAudits(f)).toHaveLength(audits + 1);
  expect(await logoEvents(f)).toHaveLength(events + 1);
});

it('a granted holder binds a file they created and cannot bind the owner file', async () => {
  await seedOverride(f, f.managerMember, {
    permission_code: 'manage:business-identity:business',
    scope_type: 'BUSINESS',
    scope_id: f.business,
  });
  const own = await insertLogoFile(f, { createdBy: f.managerId });
  const res = await put({ file_id: own }, f.managerCookie);
  expect(res.statusCode).toBe(200);
  expect(businessLogo.parse(res.json())).toEqual({ logo_file_id: own });
  const ownerFile = await insertLogoFile(f);
  const refused = await put({ file_id: ownerFile }, f.managerCookie);
  expect([refused.statusCode, errorEnvelope.parse(refused.json()).code]).toEqual([
    404,
    'FILE_NOT_FOUND',
  ]);
  const [row] = await f.h.owner`SELECT logo_file_id FROM business_settings
    WHERE company_id = ${f.company} AND business_id = ${f.business}`;
  expect(row?.['logo_file_id']).toBe(own);
});

it('a manager with settings access but not identity permission changes nothing', async () => {
  const cookie = await f.h.signedInOperator('logo-settings-manager@example.test');
  const [user] = await f.h
    .owner`SELECT id FROM "user" WHERE email = 'logo-settings-manager@example.test'`;
  await newHeldMember(f, { userId: user?.['id'] as string }, 'business_manager');
  const id = await insertLogoFile(f);
  const before = await f.h.owner`SELECT logo_file_id FROM business_settings
    WHERE company_id = ${f.company} AND business_id = ${f.business}`;
  const res = await put({ file_id: id }, cookie);
  expect([res.statusCode, errorEnvelope.parse(res.json()).code]).toEqual([403, 'FORBIDDEN']);
  const after = await f.h.owner`SELECT logo_file_id FROM business_settings
    WHERE company_id = ${f.company} AND business_id = ${f.business}`;
  expect(after).toEqual(before);
});

it('a device token is refused', async () => {
  const token = await deviceToken(f);
  const id = await insertLogoFile(f);
  const before = await f.h.owner`SELECT logo_file_id FROM business_settings
    WHERE company_id = ${f.company} AND business_id = ${f.business}`;
  const res = await f.h.app.inject({
    method: 'PUT',
    url: url(),
    payload: { file_id: id },
    headers: {
      authorization: `Device ${token}`,
      'x-company-id': f.company,
      origin: 'http://admin.test',
    },
  });
  expect([res.statusCode, errorEnvelope.parse(res.json()).code]).toEqual([403, 'FORBIDDEN']);
  const after = await f.h.owner`SELECT logo_file_id FROM business_settings
    WHERE company_id = ${f.company} AND business_id = ${f.business}`;
  expect(after).toEqual(before);
});

it('another company and a closed company are refused and write nothing', async () => {
  const id = await insertLogoFile(f);
  const before = (await logoAudits(f)).length;
  const other = await put({ file_id: id }, f.cookie, f.otherCompany);
  expect(other.statusCode).toBe(403);
  await f.h.owner`UPDATE companies SET deleted_at = now() WHERE id = ${f.company}`;
  try {
    const closed = await put({ file_id: id });
    expect([closed.statusCode, errorEnvelope.parse(closed.json()).code]).toEqual([
      403,
      'FORBIDDEN',
    ]);
    const useCase = new SetBusinessLogo(createSettingsTransactions(f.db, f.ids), {
      invalidate: async () => undefined,
    });
    await expect(
      useCase.execute({ companyId: f.company, userId: f.userId }, f.business, { file_id: id }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  } finally {
    await f.h.owner`UPDATE companies SET deleted_at = NULL WHERE id = ${f.company}`;
  }
  expect(await logoAudits(f)).toHaveLength(before);
});

it('refuses a body that is not exactly a file id', async () => {
  const before = (await logoAudits(f)).length;
  for (const body of [{}, { file_id: 'not-a-uuid' }, { file_id: f.ids.newId(), extra: true }]) {
    const res = await put(body);
    expect([res.statusCode, errorEnvelope.parse(res.json()).code]).toEqual([
      400,
      'VALIDATION_FAILED',
    ]);
  }
  expect(await logoAudits(f)).toHaveLength(before);
});

it('refuses another business, a staff document, and a file the actor does not own', async () => {
  const before = (await logoAudits(f)).length;
  const eventsBefore = (await logoEvents(f)).length;
  const foreign = await foreignBusinessId(f);
  const missing = await put({ file_id: f.ids.newId() });
  expect([missing.statusCode, errorEnvelope.parse(missing.json()).code]).toEqual([
    404,
    'FILE_NOT_FOUND',
  ]);
  await expectLogoRefusal(f, put, { businessId: f.otherBusiness, ownerEntityId: f.otherBusiness });
  await expectLogoRefusal(f, put, {
    companyId: f.otherCompany,
    businessId: foreign,
    ownerEntityId: foreign,
  });
  await expectLogoRefusal(f, put, {
    ownerModule: 'staff',
    ownerEntityId: f.ids.newId(),
    requiredPermission: 'read:files:business',
  });
  await expectLogoRefusal(f, put, { createdBy: f.managerId });
  await expectLogoRefusal(f, put, { branchId: f.branch });
  await expectLogoRefusal(f, put, { requiredPermission: 'read:files:business' });
  await expectLogoRefusal(f, put, { contentType: 'application/pdf' });
  await expectLogoRefusal(f, put, {
    contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  expect(await logoAudits(f)).toHaveLength(before);
  expect(await logoEvents(f)).toHaveLength(eventsBefore);
});

it('refuses a file whose purge started, and a logo image that is not READY yet', async () => {
  const before = (await logoEvents(f)).length;
  await expectLogoRefusal(f, put, { purgeStarted: true });
  await expectLogoRefusal(f, put, { purged: true });
  await expectLogoRefusal(f, put, { status: 'PENDING', contentType: 'application/pdf' });
  await expectLogoRefusal(f, put, { status: 'PENDING' }, [409, 'FILE_NOT_READY']);
  await expectLogoRefusal(f, put, { status: 'VERIFYING', contentType: 'image/jpeg' }, [
    409,
    'FILE_NOT_READY',
  ]);
  await expectLogoRefusal(f, put, { status: 'REJECTED' });
  expect(await logoEvents(f)).toHaveLength(before);
});

it('another tenant cannot read or write the identity row, and the logo foreign key stays inside the company', async () => {
  const id = await insertLogoFile(f);
  expect((await put({ file_id: id })).statusCode).toBe(200);
  const foreign = await foreignBusinessId(f);
  const foreignFile = await insertLogoFile(f, {
    companyId: f.otherCompany,
    businessId: foreign,
    ownerEntityId: foreign,
  });
  const seen = await f.db.withTenant(
    f.otherCompany,
    (tx) => readBusinessIdentity(tx, f.company, f.business),
    { userId: f.userId },
  );
  expect(seen).toEqual({ official_name_ar: null, official_name_en: null, logo_file_id: null });
  await f.db.withTenant(f.otherCompany, async (tx) => {
    await tx.execute(sql`UPDATE business_settings SET official_name_en = 'cross'
      WHERE company_id = ${f.company} AND business_id = ${f.business}`);
  });
  const [row] = await f.h.owner`SELECT logo_file_id, official_name_en FROM business_settings
    WHERE company_id = ${f.company} AND business_id = ${f.business}`;
  expect(row).toEqual({ logo_file_id: id, official_name_en: null });
  await expect(
    f.h.owner`UPDATE business_settings SET logo_file_id = ${foreignFile}
      WHERE company_id = ${f.company} AND business_id = ${f.business}`,
  ).rejects.toThrow();
});

it('removing a logo when the business has no settings row writes nothing', async () => {
  await f.h.owner`DELETE FROM business_settings
    WHERE company_id = ${f.company} AND business_id = ${f.business}`;
  const audits = (await logoAudits(f)).length;
  const events = (await logoEvents(f)).length;
  const res = await put({ file_id: null });
  expect(res.statusCode).toBe(200);
  expect(businessLogo.parse(res.json())).toEqual({ logo_file_id: null });
  const rows = await f.h.owner`SELECT business_id FROM business_settings
    WHERE company_id = ${f.company} AND business_id = ${f.business}`;
  expect(rows).toHaveLength(0);
  expect(await logoAudits(f)).toHaveLength(audits);
  expect(await logoEvents(f)).toHaveLength(events);
  const read = await f.h.send('GET', `/v1/businesses/${f.business}/settings`, {
    cookie: f.cookie,
    company: f.company,
  });
  expect(businessSettings.parse(read.body).updated_at).toBeNull();
});

it('binds a ready file while storage is not configured', async () => {
  const upload = await f.h.app.inject({
    method: 'POST',
    url: `/v1/businesses/${f.business}/files/uploads`,
    headers: { cookie: f.cookie, 'x-company-id': f.company },
    payload: {
      owner_module: 'settings',
      owner_entity_id: f.business,
      content_type: 'image/png',
      size_bytes: 10,
      required_permission: 'read:settings:business',
    },
  });
  expect([upload.statusCode, errorEnvelope.parse(upload.json()).code]).toEqual([
    503,
    'STORAGE_NOT_CONFIGURED',
  ]);
  const id = await insertLogoFile(f);
  const res = await put({ file_id: id });
  expect(res.statusCode).toBe(200);
  expect(businessLogo.parse(res.json())).toEqual({ logo_file_id: id });
});

it('revoked authority during the settings lock wait writes nothing', async () => {
  await f.h.owner`UPDATE permission_overrides SET expires_at = clock_timestamp()
    WHERE company_id = ${f.company} AND membership_id = ${f.managerMember}
      AND permission_code = 'manage:business-identity:business'`;
  const grant = await seedOverride(f, f.managerMember, {
    permission_code: 'manage:business-identity:business',
    scope_type: 'BUSINESS',
    scope_id: f.business,
  });
  await f.h.owner`INSERT INTO business_settings (company_id, business_id)
    VALUES (${f.company}, ${f.business}) ON CONFLICT (company_id, business_id) DO NOTHING`;
  const id = await insertLogoFile(f);
  const before = (await logoAudits(f)).length;
  const blocker = postgres(f.h.ownerUrl, { max: 1, onnotice: () => undefined });
  const observer = postgres(f.h.ownerUrl, { max: 1, onnotice: () => undefined });
  await blocker`BEGIN`;
  await blocker`SELECT business_id FROM business_settings
    WHERE company_id = ${f.company} AND business_id = ${f.business} FOR UPDATE`;
  const request = put({ file_id: id }, f.managerCookie);
  try {
    await vi.waitFor(
      async () => {
        const waiting = await observer`SELECT 1 FROM pg_stat_activity
          WHERE datname = current_database() AND wait_event_type = 'Lock' AND query LIKE '%business_settings%'`;
        expect(waiting.length).toBeGreaterThan(0);
      },
      { timeout: 5000, interval: 20 },
    );
    await observer`UPDATE permission_overrides SET expires_at = clock_timestamp() WHERE id = ${grant}`;
  } finally {
    await blocker`ROLLBACK`;
    await blocker.end();
    await observer.end();
  }
  const res = await request;
  expect([res.statusCode, errorEnvelope.parse(res.json()).code]).toEqual([403, 'FORBIDDEN']);
  expect(await logoAudits(f)).toHaveLength(before);
  const [row] = await f.h.owner`SELECT logo_file_id FROM business_settings
    WHERE company_id = ${f.company} AND business_id = ${f.business}`;
  expect(row?.['logo_file_id']).toBeNull();
});
