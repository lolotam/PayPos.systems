import {
  businessIdentityNames,
  businessSettings,
  errorEnvelope,
  updateBusinessIdentityNamesInput,
} from '@pospay/contracts';
import postgres from 'postgres';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';

import {
  newHeldMember,
  permissionFixture,
  seedOverride,
  type PermissionFixture,
} from '../../../../test/permissions-fixture.ts';
import { OfficialNameRejected } from '../domain/official-name.ts';
import { createSettingsTransactions } from '../persistence/settings-transactions.ts';
import type { SettingsTransactions } from '../ports/settings.port.ts';
import { UpdateBusinessIdentityNames } from '../use-cases/update-business-identity-names/update-business-identity-names.ts';

let f: PermissionFixture;

beforeAll(async () => {
  f = await permissionFixture();
});
afterAll(async () => {
  await f?.db.close();
  await f?.h.close();
});

const url = () => `/v1/businesses/${f.business}/settings/identity`;
const patch = (body: object, cookie = f.cookie, company = f.company) =>
  f.h.app.inject({
    method: 'PATCH',
    url: url(),
    headers: { cookie, 'x-company-id': company },
    payload: body,
  });
const audits = () =>
  f.h.owner`SELECT actor_user_id, before, after FROM audit_log
    WHERE company_id = ${f.company} AND entity = 'business_settings'
      AND entity_id = ${f.business} AND action = 'settings.identity_changed'
    ORDER BY id`;

// العقد والدومين بيرفضوا النص اللي الـ CHECK هيرفضه، فالكتابة هنا بتتبدّل بقيمة فاضية عشان 23514 يعدي من execute.
function identityCheckFailure(real: SettingsTransactions): SettingsTransactions {
  return {
    run: (companyId, userId, work) =>
      real.run(companyId, userId, async (scope) => {
        const save = scope.saveIdentity;
        scope.saveIdentity = (businessId, _change, updatedBy) =>
          save(businessId, { officialNameAr: '' }, updatedBy);
        return work(scope);
      }),
  };
}

it('the owner sets both names, trims them, and audits the three identity columns', async () => {
  const res = await patch({ official_name_ar: '  صالون لمسة  ', official_name_en: ' Lamsa ' });
  expect(res.statusCode).toBe(200);
  expect(businessIdentityNames.parse(res.json())).toEqual({
    official_name_ar: 'صالون لمسة',
    official_name_en: 'Lamsa',
  });
  const read = await f.h.send('GET', `/v1/businesses/${f.business}/settings`, {
    cookie: f.cookie,
    company: f.company,
  });
  expect(businessSettings.parse(read.body)).toMatchObject({
    official_name_ar: 'صالون لمسة',
    official_name_en: 'Lamsa',
    logo_file_id: null,
  });
  expect(await audits()).toEqual([
    {
      actor_user_id: f.userId,
      before: { official_name_ar: null, official_name_en: null, logo_file_id: null },
      after: { official_name_ar: 'صالون لمسة', official_name_en: 'Lamsa', logo_file_id: null },
    },
  ]);
});

it('an omitted key stays and null clears, and the same value is still audited', async () => {
  const cleared = await patch({ official_name_en: null });
  expect(cleared.statusCode).toBe(200);
  expect(businessIdentityNames.parse(cleared.json())).toEqual({
    official_name_ar: 'صالون لمسة',
    official_name_en: null,
  });
  const again = await patch({ official_name_ar: 'صالون لمسة' });
  expect(again.statusCode).toBe(200);
  const rows = await audits();
  expect(rows).toHaveLength(3);
  expect(rows[1]).toEqual({
    actor_user_id: f.userId,
    before: { official_name_ar: 'صالون لمسة', official_name_en: 'Lamsa', logo_file_id: null },
    after: { official_name_ar: 'صالون لمسة', official_name_en: null, logo_file_id: null },
  });
  expect(rows[2]?.after).toMatchObject({ official_name_ar: 'صالون لمسة', official_name_en: null });
});

it('refuses an empty body, a blank name, 256 characters, and an unknown key without an audit', async () => {
  const before = await audits();
  for (const body of [
    {},
    { official_name_ar: ' ' },
    { official_name_en: 'a'.repeat(256) },
    { official_name_ar: 'Synthetic\u0000name' },
    { theme: 'dark' },
  ]) {
    const res = await patch(body);
    expect([res.statusCode, errorEnvelope.parse(res.json()).code]).toEqual([400, 'VALIDATION_FAILED']);
  }
  expect(await audits()).toHaveLength(before.length);
  const accepted = await patch({ official_name_en: '😀'.repeat(255) });
  expect(accepted.statusCode).toBe(200);
  expect(businessIdentityNames.parse(accepted.json()).official_name_en).toBe('😀'.repeat(255));
});

it('a holder of only the identity permission can patch and still cannot read settings', async () => {
  await seedOverride(f, f.managerMember, {
    permission_code: 'manage:business-identity:business',
    scope_type: 'BUSINESS',
    scope_id: f.business,
  });
  const read = await f.h.send('GET', `/v1/businesses/${f.business}/settings`, {
    cookie: f.managerCookie,
    company: f.company,
  });
  expect(read.status).toBe(403);
  const res = await patch({ official_name_en: 'Holder' }, f.managerCookie);
  expect(res.statusCode).toBe(200);
  expect(businessIdentityNames.parse(res.json())).toEqual({
    official_name_ar: 'صالون لمسة',
    official_name_en: 'Holder',
  });
});

it('a manager with settings access but not identity permission changes nothing', async () => {
  const cookie = await f.h.signedInOperator('identity-settings-manager@example.test');
  const [user] = await f.h.owner`SELECT id FROM "user" WHERE email = 'identity-settings-manager@example.test'`;
  await newHeldMember(f, { userId: user?.['id'] as string }, 'business_manager');
  const before = await f.h.owner`SELECT official_name_ar, official_name_en FROM business_settings
    WHERE company_id = ${f.company} AND business_id = ${f.business}`;
  const res = await patch({ official_name_ar: 'Manager' }, cookie);
  expect([res.statusCode, errorEnvelope.parse(res.json()).code]).toEqual([403, 'FORBIDDEN']);
  const after = await f.h.owner`SELECT official_name_ar, official_name_en FROM business_settings
    WHERE company_id = ${f.company} AND business_id = ${f.business}`;
  expect(after).toEqual(before);
});

it('a device token is refused', async () => {
  const code = await f.h.send('POST', `/v1/branches/${f.branch}/devices/pairing-code`, {
    cookie: f.cookie,
    company: f.company,
  });
  expect(code.status).toBe(201);
  const registered = await f.h.app.inject({
    method: 'POST',
    url: '/v1/devices/register',
    payload: { pairing_code: code.body['code'], label: 'Synthetic identity refusal' },
  });
  expect(registered.statusCode).toBe(201);
  const device = registered.json<{ company_id: string; device_id: string; claim_secret: string }>();
  const approved = await f.h.send('POST', `/v1/branches/${f.branch}/devices/${device.device_id}/approve`, {
    cookie: f.cookie,
    company: f.company,
  });
  expect(approved.status).toBe(204);
  const claimed = await f.h.app.inject({ method: 'POST', url: '/v1/devices/claim', payload: device });
  expect(claimed.statusCode).toBe(200);
  const token = claimed.json<{ device_token: string }>().device_token;
  const res = await f.h.app.inject({
    method: 'PATCH',
    url: url(),
    payload: { official_name_en: 'Device' },
    headers: { authorization: `Device ${token}`, 'x-company-id': f.company, origin: 'http://admin.test' },
  });
  expect([res.statusCode, errorEnvelope.parse(res.json()).code]).toEqual([403, 'FORBIDDEN']);
});

it("another company and a closed company are refused and write nothing", async () => {
  const before = (await audits()).length;
  const other = await patch({ official_name_en: 'Other' }, f.cookie, f.otherCompany);
  expect(other.statusCode).toBe(403);
  await f.h.owner`UPDATE companies SET deleted_at = now() WHERE id = ${f.company}`;
  try {
    const closed = await patch({ official_name_en: 'Closed' });
    expect([closed.statusCode, errorEnvelope.parse(closed.json()).code]).toEqual([403, 'FORBIDDEN']);
    const useCase = new UpdateBusinessIdentityNames(createSettingsTransactions(f.db, f.ids), {
      invalidate: async () => undefined,
    });
    await expect(
      useCase.execute({ companyId: f.company, userId: f.userId }, f.business, { official_name_en: 'Closed' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  } finally {
    await f.h.owner`UPDATE companies SET deleted_at = NULL WHERE id = ${f.company}`;
  }
  expect(await audits()).toHaveLength(before);
});

it('a check violation from storage is validation and rolls back', async () => {
  const transactions = createSettingsTransactions(f.db, f.ids);
  await expect(
    transactions.run(f.company, f.userId, async (scope) => {
      await scope.findForUpdate(f.business);
      return scope.saveIdentity(f.business, { officialNameAr: '' }, f.userId);
    }),
  ).rejects.toBeInstanceOf(OfficialNameRejected);
  const [row] = await f.h.owner`SELECT official_name_ar FROM business_settings
    WHERE company_id = ${f.company} AND business_id = ${f.business}`;
  expect(row?.['official_name_ar']).toBe('صالون لمسة');
});

it('execute maps a stored check violation to validation and leaves the row', async () => {
  const [before] = await f.h.owner`SELECT official_name_ar, official_name_en, logo_file_id
    FROM business_settings WHERE company_id = ${f.company} AND business_id = ${f.business}`;
  const useCase = new UpdateBusinessIdentityNames(
    identityCheckFailure(createSettingsTransactions(f.db, f.ids)),
    { invalidate: async () => undefined },
  );
  const input = updateBusinessIdentityNamesInput.parse({ official_name_en: 'Contract accepts this' });
  await expect(
    useCase.execute({ companyId: f.company, userId: f.userId }, f.business, input),
  ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  const [after] = await f.h.owner`SELECT official_name_ar, official_name_en, logo_file_id
    FROM business_settings WHERE company_id = ${f.company} AND business_id = ${f.business}`;
  expect(after).toEqual(before);
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
  const before = (await audits()).length;
  const blocker = postgres(f.h.ownerUrl, { max: 1, onnotice: () => undefined });
  await blocker`BEGIN`;
  await blocker`SELECT business_id FROM business_settings
    WHERE company_id = ${f.company} AND business_id = ${f.business} FOR UPDATE`;
  const request = patch({ official_name_en: 'Raced' }, f.managerCookie);
  const observer = postgres(f.h.ownerUrl, { max: 1, onnotice: () => undefined });
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
  expect(await audits()).toHaveLength(before);
  const [row] = await f.h.owner`SELECT official_name_en FROM business_settings
    WHERE company_id = ${f.company} AND business_id = ${f.business}`;
  expect(row?.['official_name_en']).toBe('Holder');
});

it('a cached settings read is replaced by the names written in the next patch', async () => {
  const read = () =>
    f.h.send('GET', `/v1/businesses/${f.business}/settings`, { cookie: f.cookie, company: f.company });
  const cached = businessSettings.parse((await read()).body);
  const next = cached.official_name_en === 'Cache After' ? 'Cache Before' : 'Cache After';
  const patched = await patch({ official_name_en: next });
  expect(patched.statusCode).toBe(200);
  expect(businessSettings.parse((await read()).body).official_name_en).toBe(next);
});
