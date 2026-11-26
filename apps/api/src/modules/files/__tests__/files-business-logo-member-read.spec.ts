import { expect, it } from 'vitest';

import {
  business,
  company,
  cookie,
  h,
  ids,
  readerCookie,
  readerId,
} from './files.fixture.ts';

/** ملف إعدادات زي شعار النشاط: مالكه الوحدة settings وصلاحيته إدارة هوية النشاط. */
async function seedSettingsFile(): Promise<string> {
  const id = ids.newId();
  await h.owner`INSERT INTO file_objects(
      company_id, id, business_id, owner_module, owner_entity_id, staging_key, storage_key,
      content_type, size_bytes, required_permission, created_by, created_at, status)
    VALUES (
      ${company}, ${id}, ${business}, 'settings', ${business}, ${`staging-${id}`}, ${`verified-${id}`},
      'image/png', 10, 'manage:business-identity:business', ${readerId}, now(), 'READY')`;
  return id;
}

/** يربط الملف بالشعار المربوط للنشاط؛ الربط لازم يكون بعد إنشاء الملف بسبب الـ foreign key. */
async function bindLogo(fileId: string): Promise<void> {
  await h.owner`INSERT INTO business_settings (company_id, business_id, logo_file_id)
    VALUES (${company}, ${business}, ${fileId})
    ON CONFLICT (company_id, business_id) DO UPDATE SET logo_file_id = EXCLUDED.logo_file_id`;
}

async function auditOutcome(fileId: string, actorId: string): Promise<string | undefined> {
  const [row] =
    await h.owner`SELECT outcome FROM file_access_audit
      WHERE company_id = ${company} AND file_id = ${fileId} AND actor_user_id = ${actorId}
      ORDER BY accessed_at DESC`;
  return row?.['outcome'] as string | undefined;
}

it('a business member without the identity permission downloads the bound logo', async () => {
  const fileId = await seedSettingsFile();
  await bindLogo(fileId);
  const response = await h.send('POST', `/v1/files/${fileId}/download`, {
    cookie: readerCookie,
    company,
  });
  expect(response.status).toBe(200);
  expect(response.body['download_url']).toContain('http');
  expect(await auditOutcome(fileId, readerId)).toBe('ALLOW');
});

it('an unbound settings file stays denied even for a covering member', async () => {
  const bound = await seedSettingsFile();
  await bindLogo(bound);
  const unbound = await seedSettingsFile();
  const response = await h.send('POST', `/v1/files/${unbound}/download`, {
    cookie: readerCookie,
    company,
  });
  expect(response.status).toBe(404);
  expect(await auditOutcome(unbound, readerId)).toBe('DENY');
});

it('a member of another business is denied the logo of this business', async () => {
  const fileId = await seedSettingsFile();
  await bindLogo(fileId);
  const created = await h.send('POST', '/v1/businesses', {
    cookie,
    company,
    key: 'files-logo-other-business',
    body: { vertical_type: 'salon', name_en: 'Other business' },
  });
  expect(created.status).toBe(201);
  const otherBusiness = created.body['id'] as string;
  const outsiderCookie = await h.signedInOperator('files-logo-outsider@synthetic.invalid');
  const [user] =
    await h.owner`SELECT id FROM "user" WHERE email = 'files-logo-outsider@synthetic.invalid'`;
  const outsiderId = user?.['id'] as string;
  const roleId = ids.newId();
  await h.owner`INSERT INTO roles(id,company_id,code,name_en)
    VALUES (${roleId},${company},'synthetic_logo_outsider','Synthetic logo outsider')`;
  await h.owner`INSERT INTO memberships (company_id,id,user_id,role_id,role_owner_key,scope_type,scope_id)
    VALUES (${company},${ids.newId()},${outsiderId},${roleId},${company},'BUSINESS',${otherBusiness})`;
  const response = await h.send('POST', `/v1/files/${fileId}/download`, {
    cookie: outsiderCookie,
    company,
  });
  expect(response.status).toBe(404);
  expect(await auditOutcome(fileId, outsiderId)).toBe('DENY');
});

it('a branch-scoped member of the business downloads the bound logo', async () => {
  const fileId = await seedSettingsFile();
  await bindLogo(fileId);
  const created = await h.send('POST', `/v1/businesses/${business}/branches`, {
    cookie,
    company,
    key: 'files-logo-branch',
    body: { name_en: 'Logo Branch' },
  });
  expect(created.status).toBe(201);
  const branchId = created.body['id'] as string;
  const branchCookie = await h.signedInOperator('files-logo-branch@synthetic.invalid');
  const [user] =
    await h.owner`SELECT id FROM "user" WHERE email = 'files-logo-branch@synthetic.invalid'`;
  const branchUserId = user?.['id'] as string;
  const roleId = ids.newId();
  await h.owner`INSERT INTO roles(id,company_id,code,name_en)
    VALUES (${roleId},${company},'synthetic_logo_branch','Synthetic logo branch')`;
  await h.owner`INSERT INTO memberships (company_id,id,user_id,role_id,role_owner_key,scope_type,scope_id)
    VALUES (${company},${ids.newId()},${branchUserId},${roleId},${company},'BRANCH',${branchId})`;
  const response = await h.send('POST', `/v1/files/${fileId}/download`, {
    cookie: branchCookie,
    company,
  });
  expect(response.status).toBe(200);
  expect(response.body['download_url']).toContain('http');
  expect(await auditOutcome(fileId, branchUserId)).toBe('ALLOW');
});

it('a member whose membership for this business has ended is denied the bound logo even while active in another business', async () => {
  const fileId = await seedSettingsFile();
  await bindLogo(fileId);
  const created = await h.send('POST', '/v1/businesses', {
    cookie,
    company,
    key: 'files-logo-ended-other',
    body: { vertical_type: 'salon', name_en: 'Active other business' },
  });
  expect(created.status).toBe(201);
  const otherBusiness = created.body['id'] as string;
  const endedCookie = await h.signedInOperator('files-logo-ended@synthetic.invalid');
  const [user] =
    await h.owner`SELECT id FROM "user" WHERE email = 'files-logo-ended@synthetic.invalid'`;
  const endedUserId = user?.['id'] as string;
  const roleId = ids.newId();
  await h.owner`INSERT INTO roles(id,company_id,code,name_en)
    VALUES (${roleId},${company},'synthetic_logo_ended','Synthetic logo ended')`;
  await h.owner`INSERT INTO memberships (company_id,id,user_id,role_id,role_owner_key,scope_type,scope_id,starts_at,ends_at)
    VALUES
      (${company},${ids.newId()},${endedUserId},${roleId},${company},'BUSINESS',${otherBusiness},now() - interval '2 minutes',NULL),
      (${company},${ids.newId()},${endedUserId},${roleId},${company},'BUSINESS',${business},now() - interval '2 minutes',now() - interval '1 minute')`;
  const response = await h.send('POST', `/v1/files/${fileId}/download`, {
    cookie: endedCookie,
    company,
  });
  expect(response.status).toBe(404);
  expect(await auditOutcome(fileId, endedUserId)).toBe('DENY');
});
