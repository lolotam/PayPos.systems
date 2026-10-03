import { expect, it } from 'vitest';
import { buildObjectKey } from '@pospay/storage';
import {
  h,
  verifier,
  cookie,
  company,
  business,
  readerCookie,
  readerId,
  readerMembership,
  ids,
  pdf,
  upload,
  ready,
  grantRead,
  input,
} from './files.fixture.ts';

it('a branch DENY overrides a business ALLOW for download by id/key and metadata', async () => {
  const branch = ids.newId();
  await h.owner`INSERT INTO branches(company_id,id,business_id,name_en)
    VALUES (${company},${branch},${business},'Synthetic branch')`;
  const ticket = await upload({ branch_id: branch });
  await fetch(ticket.url, {
    method: 'PUT',
    headers: { 'content-type': 'application/pdf' },
    body: pdf,
  });
  await verifier.execute(company, ticket.id);
  const key = (await h.send('GET', `/v1/files/${ticket.id}`, { cookie, company })).body[
    'storage_key'
  ];
  await grantRead();
  expect(
    (await h.send('GET', `/v1/files/${ticket.id}`, { cookie: readerCookie, company })).status,
  ).toBe(200);
  const deny = ids.newId();
  await h.owner`INSERT INTO permission_overrides(company_id,id,membership_id,permission_code,effect,scope_type,scope_id,reason,granted_by)
    VALUES (${company},${deny},${readerMembership},'read:files:business','DENY','BRANCH',${branch},'Synthetic branch deny',${readerId})`;
  for (const [method, path, body] of [
    ['POST', `/v1/files/${ticket.id}/download`, undefined],
    ['POST', '/v1/files/download', { storage_key: key }],
    ['GET', `/v1/files/${ticket.id}`, undefined],
  ] as const) {
    const response = await h.send(method, path, {
      cookie: readerCookie,
      company,
      ...(body ? { body } : {}),
    });
    expect(response.status).toBe(404);
    expect(response.body['code']).toBe('FILE_NOT_FOUND');
    expect(response.body).not.toHaveProperty('download_url');
    expect(response.body).not.toHaveProperty('storage_key');
  }
  const rows =
    await h.owner`SELECT outcome FROM file_access_audit WHERE company_id = ${company} AND file_id = ${ticket.id}`;
  expect(rows.map((r) => r['outcome'])).toEqual(['DENY', 'DENY']);
  await h.owner`DELETE FROM permission_overrides WHERE company_id = ${company} AND id = ${deny}`;
});

it('unknown and inaccessible files have identical status/code/body by id and key, with internal DENY audits', async () => {
  const ticket = await ready();
  const key = (await h.send('GET', `/v1/files/${ticket.id}`, { cookie, company })).body[
    'storage_key'
  ];
  await h.owner`DELETE FROM permission_overrides WHERE company_id = ${company} AND membership_id = ${readerMembership}`;
  for (const [path, unknownPath, body, unknownBody] of [
    [`/v1/files/${ticket.id}/download`, `/v1/files/${ids.newId()}/download`, undefined, undefined],
    [
      '/v1/files/download',
      '/v1/files/download',
      { storage_key: key },
      { storage_key: buildObjectKey(company, business, ids.newId(), 'verified') },
    ],
  ] as const) {
    const denied = await h.send('POST', path, {
      cookie: readerCookie,
      company,
      ...(body ? { body } : {}),
    });
    const absent = await h.send('POST', unknownPath, {
      cookie: readerCookie,
      company,
      ...(unknownBody ? { body: unknownBody } : {}),
    });
    expect({ status: denied.status, body: denied.body }).toEqual({
      status: absent.status,
      body: absent.body,
    });
    expect(denied.status).toBe(404);
  }
  const rows =
    await h.owner`SELECT outcome FROM file_access_audit WHERE company_id = ${company} AND file_id = ${ticket.id}`;
  expect(rows.map((r) => r['outcome'])).toEqual(['DENY', 'DENY']);
});

it('the uploader also retains its branch scope for metadata, confirmation and another upload', async () => {
  const branch = ids.newId();
  await h.owner`INSERT INTO branches(company_id,id,business_id,name_en)
    VALUES (${company},${branch},${business},'Synthetic managed branch')`;
  await grantRead();
  await h.owner`INSERT INTO permission_overrides(company_id,id,membership_id,permission_code,effect,scope_type,scope_id,reason,granted_by)
    VALUES (${company},${ids.newId()},${readerMembership},'manage:files:business','ALLOW','BUSINESS',${business},'Synthetic uploader grant',${readerId})`;
  const created = await h.send('POST', `/v1/businesses/${business}/files/uploads`, {
    cookie: readerCookie,
    company,
    body: { ...input(), branch_id: branch },
  });
  expect(created.status).toBe(201);
  const ticket = { id: created.body['id'] as string };
  const deny = ids.newId();
  await h.owner`INSERT INTO permission_overrides(company_id,id,membership_id,permission_code,effect,scope_type,scope_id,reason,granted_by)
    VALUES (${company},${deny},${readerMembership},'manage:files:business','DENY','BRANCH',${branch},'Synthetic management deny',${readerId})`;
  expect(
    (await h.send('GET', `/v1/files/${ticket.id}`, { cookie: readerCookie, company })).status,
  ).toBe(404);
  expect(
    (await h.send('POST', `/v1/files/${ticket.id}/confirm`, { cookie: readerCookie, company }))
      .status,
  ).toBe(404);
  expect(
    (
      await h.send('POST', `/v1/businesses/${business}/files/uploads`, {
        cookie: readerCookie,
        company,
        body: { ...input(), branch_id: branch },
      })
    ).status,
  ).toBe(403);
  expect(
    (
      await h.send('POST', `/v1/businesses/${business}/files/uploads`, {
        cookie: readerCookie,
        company,
        body: input(),
      })
    ).status,
  ).toBe(201);
  await h.owner`DELETE FROM permission_overrides WHERE company_id = ${company} AND id = ${deny}`;
});
