import { expect, it } from 'vitest';

import {
  company,
  business,
  h,
  ids,
  readerCookie,
  readerId,
  readerMembership,
} from './files.fixture.ts';

async function storedByReader() {
  const [row] =
    await h.owner`SELECT count(*)::int AS count FROM file_objects WHERE company_id = ${company} AND created_by = ${readerId}`;
  return row?.['count'];
}

function logoUploadBody() {
  return {
    owner_module: 'settings',
    owner_entity_id: business,
    content_type: 'image/png',
    size_bytes: 10,
    required_permission: 'manage:business-identity:business',
  };
}

it('an identity delegate cannot store a non-logo file through a settings upload', async () => {
  await h.owner`INSERT INTO permission_overrides (company_id,id,membership_id,permission_code,effect,scope_type,scope_id,reason,granted_by)
    VALUES (${company},${ids.newId()},${readerMembership},'manage:business-identity:business','ALLOW','BUSINESS',${business},'synthetic grant',${readerId})`;
  const before = await storedByReader();
  const pdf = await h.send('POST', `/v1/businesses/${business}/files/uploads`, {
    cookie: readerCookie,
    company,
    body: { ...logoUploadBody(), content_type: 'application/pdf' },
  });
  expect(pdf.body['code']).toBe('FILE_TYPE_INVALID');
  const elsewhere = await h.send('POST', `/v1/businesses/${business}/files/uploads`, {
    cookie: readerCookie,
    company,
    body: { ...logoUploadBody(), owner_entity_id: ids.newId() },
  });
  expect([elsewhere.status, elsewhere.body['code']]).toEqual([403, 'FORBIDDEN']);
  const logo = await h.send('POST', `/v1/businesses/${business}/files/uploads`, {
    cookie: readerCookie,
    company,
    body: logoUploadBody(),
  });
  expect(logo.status).toBe(201);
  expect(await storedByReader()).toBe(before + 1);
});
