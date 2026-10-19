import { expect, it } from 'vitest';

import {
  company,
  business,
  cookie,
  h,
  ids,
  readerCookie,
  readerId,
  readerMembership,
  ready,
} from './files.fixture.ts';

async function grantReader(permission: string) {
  await h.owner`INSERT INTO permission_overrides (company_id,id,membership_id,permission_code,effect,scope_type,scope_id,reason,granted_by)
    VALUES (${company},${ids.newId()},${readerMembership},${permission},'ALLOW','BUSINESS',${business},'synthetic grant',${readerId})`;
}

async function seedLegacySettingsLogo() {
  const id = ids.newId();
  await h.owner`INSERT INTO file_objects(
      company_id, id, business_id, owner_module, owner_entity_id, staging_key, storage_key,
      content_type, size_bytes, required_permission, created_by, created_at, status)
    VALUES (
      ${company}, ${id}, ${business}, 'settings', ${business}, ${`staging-${id}`}, ${`verified-${id}`},
      'image/png', 10, 'read:settings:business', ${readerId}, now(), 'READY')`;
  return id;
}

it('an identity delegate reads, binds and downloads a legacy settings logo', async () => {
  await grantReader('manage:business-identity:business');
  const id = await seedLegacySettingsLogo();
  expect(
    (await h.send('GET', `/v1/files/${id}`, { cookie: readerCookie, company })).body['status'],
  ).toBe('READY');
  expect(
    (
      await h.app.inject({
        method: 'PUT',
        url: `/v1/businesses/${business}/settings/logo`,
        headers: { cookie: readerCookie, 'x-company-id': company },
        payload: { file_id: id },
      })
    ).statusCode,
  ).toBe(200);
  const preview = await h.send('POST', `/v1/files/${id}/download`, {
    cookie: readerCookie,
    company,
  });
  expect(preview.status).toBe(200);
  const [audit] =
    await h.owner`SELECT outcome FROM file_access_audit WHERE company_id = ${company} AND file_id = ${id} AND actor_user_id = ${readerId}`;
  expect(audit?.['outcome']).toBe('ALLOW');
});

it('read:settings alone cannot download a settings file, and a staff document still can', async () => {
  await grantReader('read:settings:business');
  const legacy = await seedLegacySettingsLogo();
  expect(
    (await h.send('POST', `/v1/files/${legacy}/download`, { cookie: readerCookie, company }))
      .status,
  ).toBe(404);
  const [denied] =
    await h.owner`SELECT outcome FROM file_access_audit WHERE company_id = ${company} AND file_id = ${legacy} AND actor_user_id = ${readerId}`;
  expect(denied?.['outcome']).toBe('DENY');
  const staff = await ready();
  expect((await h.send('POST', `/v1/files/${staff.id}/download`, { cookie, company })).status).toBe(
    200,
  );
});
