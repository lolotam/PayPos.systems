import { afterAll, beforeAll, expect, it } from 'vitest';
import { documentIds, documentsFixture, type DocumentsFixture } from './documents.fixture.ts';
import { termsFor } from './employees.fixture.ts';

let f: DocumentsFixture;
let numberedId: string;
let noNumberId: string;
let replacedId: string;
let deletedId: string;
let otherCookie: string;
let otherMembership: string;
beforeAll(async () => {
  f = await documentsFixture();
  numberedId = documentIds.newId();
  noNumberId = documentIds.newId();
  replacedId = documentIds.newId();
  deletedId = documentIds.newId();
  await f.h
    .owner`INSERT INTO employee_documents(company_id,id,business_id,employee_id,type_code,object_key,uploaded_by,recorded_at,document_number)
    VALUES (${f.company},${numberedId},${f.business},${f.employee.id},'work_contract','dn-http-current',${f.userId},now(),'SYN-DOC-HTTP-1')`;
  await f.h
    .owner`INSERT INTO employee_documents(company_id,id,business_id,employee_id,type_code,object_key,uploaded_by,recorded_at,document_number)
    VALUES (${f.company},${noNumberId},${f.business},${f.employee.id},'passport','dn-http-nonumber',${f.userId},now(),NULL)`;
  await f.h
    .owner`INSERT INTO employee_documents(company_id,id,business_id,employee_id,type_code,object_key,uploaded_by,recorded_at,replaced_at,document_number)
    VALUES (${f.company},${replacedId},${f.business},${f.employee.id},'civil_id','dn-http-replaced',${f.userId},now(),now(),'SYN-DOC-HTTP-OLD')`;
  const third = await f.useCase.execute({
    companyId: f.company,
    userId: f.userId,
    businessId: f.business,
    input: termsFor(f, 'Synthetic leaver'),
  });
  await f.h
    .owner`INSERT INTO employee_documents(company_id,id,business_id,employee_id,type_code,object_key,uploaded_by,recorded_at,document_number)
    VALUES (${f.company},${deletedId},${f.business},${third.id},'civil_id','dn-http-deleted',${f.userId},now(),'SYN-DOC-HTTP-GONE')`;
  await f.h
    .owner`UPDATE employees SET deleted_at=now() WHERE company_id=${f.company} AND id=${third.id}`;
  otherCookie = await f.h.signedInOperator('document-nonreader@example.test');
  const [otherUser] = await f.h
    .owner`SELECT id FROM "user" WHERE email='document-nonreader@example.test'`;
  const role = documentIds.newId();
  await f.h.owner`INSERT INTO roles(id,company_id,code,name_en)
    VALUES (${role},${f.company},'synthetic_no_files','Synthetic no files')`;
  otherMembership = documentIds.newId();
  await f.h
    .owner`INSERT INTO memberships(company_id,id,user_id,role_id,role_owner_key,scope_type,scope_id,starts_at)
    VALUES (${f.company},${otherMembership},${otherUser?.['id'] as string},${role},${f.company},'COMPANY',${f.company},'2026-01-01')`;
});
afterAll(async () => {
  await f?.db.close();
  await f?.h.close();
});
const read = async (businessId: string, ids: string, cookie = f.cookie) =>
  f.h.app.inject({
    method: 'GET',
    url: `/v1/businesses/${businessId}/employee-document-numbers?ids=${encodeURIComponent(ids)}`,
    headers: { cookie, 'x-company-id': f.company, origin: 'http://admin.test' },
  });

it('DN-10 returns exactly the requested current numbered documents of the business, no-store', async () => {
  const response = await read(f.business, `${numberedId},${noNumberId}`);
  expect(response.statusCode).toBe(200);
  expect(response.headers['cache-control']).toBe('no-store');
  expect(response.json()).toEqual({
    items: [{ document_id: numberedId, document_number: 'SYN-DOC-HTTP-1' }],
  });
});

it('DN-11 omits replaced and deleted-employee documents from the same answer', async () => {
  const response = await read(f.business, `${numberedId},${replacedId},${deletedId}`);
  expect(response.statusCode).toBe(200);
  expect(response.json()).toEqual({
    items: [{ document_id: numberedId, document_number: 'SYN-DOC-HTTP-1' }],
  });
});

it('DN-12 the same business id in another business context answers empty', async () => {
  const response = await read(f.secondBusiness, numberedId);
  expect(response.statusCode).toBe(200);
  expect(response.json()).toEqual({ items: [] });
});

it('DN-13 a membership without read:files:business gets the same 404 for every shape-valid ids value', async () => {
  const bodies = new Set<string>();
  for (const ids of [String(numberedId), documentIds.newId()]) {
    const response = await read(f.business, ids, otherCookie);
    expect(response.statusCode).toBe(404);
    expect(response.json().code).toBe('NOT_FOUND');
    expect(response.body).not.toContain('SYN-DOC');
    bodies.add(response.body);
  }
  expect(bodies.size).toBe(1);
});

it('refuses missing and foreign businesses uniformly for a company-scoped reader', async () => {
  expect((await read(f.business, numberedId)).statusCode).toBe(200);
  const missing = await read(documentIds.newId(), numberedId);
  const foreign = await read(f.foreignBusiness, numberedId);
  expect(missing.statusCode).toBe(404);
  expect(foreign.statusCode).toBe(404);
  expect(missing.json().code).toBe('NOT_FOUND');
  expect(foreign.json()).toEqual(missing.json());
});

it('applies a business-scoped refusal to both document reads regardless of UUID casing', async () => {
  const grant = documentIds.newId();
  const denial = documentIds.newId();
  await f.h
    .owner`INSERT INTO permission_overrides(company_id,id,membership_id,permission_code,effect,scope_type,scope_id,reason,granted_by)
    VALUES (${f.company},${grant},${otherMembership},'read:files:business','ALLOW','COMPANY',${f.company},'Synthetic company grant',${f.userId})`;
  try {
    expect((await read(f.business, numberedId, otherCookie)).statusCode).toBe(200);
    await f.h
      .owner`INSERT INTO permission_overrides(company_id,id,membership_id,permission_code,effect,scope_type,scope_id,reason,granted_by)
      VALUES (${f.company},${denial},${otherMembership},'read:files:business','DENY','BUSINESS',${f.business},'Synthetic business denial',${f.userId})`;
    for (const business of [f.business, f.business.toUpperCase()]) {
      const lookup = await read(business, numberedId, otherCookie);
      const list = await f.h.send(
        'GET',
        `/v1/businesses/${business}/employees/${f.employee.id}/documents`,
        { cookie: otherCookie, company: f.company },
      );
      expect(lookup.statusCode).toBe(404);
      expect(lookup.json().code).toBe('NOT_FOUND');
      expect(list.status).toBe(404);
      expect(list.body['code']).toBe('NOT_FOUND');
    }
  } finally {
    await f.h
      .owner`DELETE FROM permission_overrides WHERE company_id=${f.company} AND id IN (${grant},${denial})`;
  }
});

it('DN-13b shape validation precedes the permission check for every caller', async () => {
  for (const cookie of [f.cookie, otherCookie]) {
    const response = await read(f.business, 'not-a-uuid', cookie);
    expect(response.statusCode).toBe(400);
    expect(response.json().code).toBe('VALIDATION_FAILED');
    expect(response.body).not.toContain('SYN-DOC');
  }
});

it('DN-14 feature staff off answers FEATURE_DISABLED', async () => {
  await f.h.owner`INSERT INTO company_feature_overrides(company_id,flag,enabled,reason,set_by)
    VALUES (${f.company},'staff',false,'Synthetic feature refusal',${f.userId})`;
  try {
    const response = await read(f.business, String(numberedId));
    expect(response.json().code).toBe('FEATURE_DISABLED');
  } finally {
    await f.h
      .owner`DELETE FROM company_feature_overrides WHERE company_id=${f.company} AND flag='staff'`;
  }
});

it('DN-15 bounds the id set: empty, 21 ids, non-uuid and duplicates are VALIDATION_FAILED', async () => {
  for (const ids of [
    '',
    `${Array.from({ length: 21 }, () => numberedId).join(',')}`,
    'not-a-uuid',
    `${numberedId},${numberedId}`,
  ]) {
    const response = await read(f.business, ids);
    expect(response.statusCode).toBe(400);
    expect(response.json().code).toBe('VALIDATION_FAILED');
    expect(response.headers['cache-control']).toBe('no-store');
  }
});

it('DN-16 canonicalizes uuid case and refuses repeated ids parameters', async () => {
  const upper = numberedId.toUpperCase();
  expect((await read(f.business, upper)).json()).toEqual({
    items: [{ document_id: numberedId, document_number: 'SYN-DOC-HTTP-1' }],
  });
  const repeated = await f.h.app.inject({
    method: 'GET',
    url: `/v1/businesses/${f.business}/employee-document-numbers?ids=${numberedId}&ids=${numberedId}`,
    headers: { cookie: f.cookie, 'x-company-id': f.company, origin: 'http://admin.test' },
  });
  expect(repeated.statusCode).toBe(400);
  expect(repeated.json().code).toBe('VALIDATION_FAILED');
});

it('DN-17 no session is 401', async () => {
  const response = await f.h.app.inject({
    method: 'GET',
    url: `/v1/businesses/${f.business}/employee-document-numbers?ids=${numberedId}`,
    headers: { 'x-company-id': f.company, origin: 'http://admin.test' },
  });
  expect([401, 403]).toContain(response.statusCode);
});
