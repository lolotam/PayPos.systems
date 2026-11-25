import { expect, it } from 'vitest';

import { createServiceImportHttpHarness, XLSX } from './service-import-http.harness.ts';

// مسارات استيراد الخدمات عبر HTTP الحقيقي: الحراسة والراية والملفات الإنتاجية كلها في الطريق
// (MEDIUM مراجعة 1186: اختبارات القبول الأربعة — مسموح، بلا جلسة، بلا صلاحية، الراية مقفولة).

const t = createServiceImportHttpHarness();

it('answers the template over the real route for an allowed session', async () => {
  await t.grant();
  const res = await t.h.send('GET', `/v1/businesses/${t.business}/services/import/template`, {
    cookie: t.cookie,
    company: t.company,
  });
  expect(res.status).toBe(200);
  expect(res.body['content_type']).toBe(XLSX);
  expect(String(res.body['content_base64']).length).toBeGreaterThan(100);
  await t.revoke();
});

it('demands a session before anything else', async () => {
  const res = await t.h.app.inject({
    method: 'GET',
    url: `/v1/businesses/${t.business}/services/import/template`,
    headers: { 'x-company-id': t.company },
  });
  expect(res.statusCode).toBe(401);
});

it('denies a member without the manage permission with the exact envelope', async () => {
  await t.revoke();
  const res = await t.h.send('GET', `/v1/businesses/${t.business}/services/import/template`, {
    cookie: t.cookie,
    company: t.company,
  });
  expect(res.status).toBe(403);
  expect(res.body['code']).toBe('FORBIDDEN');
});

it('denies every route while the catalog feature is disabled, then recovers', async () => {
  await t.grant();
  await t.h.owner`INSERT INTO company_feature_overrides(company_id,flag,enabled,reason,set_by)
    VALUES (${t.company},'catalog',false,'HTTP test',${t.userId})`;
  try {
    const template = await t.h.send('GET', `/v1/businesses/${t.business}/services/import/template`, {
      cookie: t.cookie,
      company: t.company,
    });
    expect(template.status).toBe(403);
    expect(template.body['code']).toBe('FEATURE_DISABLED');
    const bytes = await t.workbook();
    const fileId = await t.upload(bytes, t.userId);
    const preview = await t.h.send('POST', `/v1/businesses/${t.business}/services/import/previews`, {
      cookie: t.cookie,
      company: t.company,
      body: { file_id: fileId },
    });
    expect(preview.status).toBe(403);
    expect(preview.body['code']).toBe('FEATURE_DISABLED');
  } finally {
    await t.h.owner`DELETE FROM company_feature_overrides WHERE company_id=${t.company} AND flag='catalog'`;
  }
});

it('previews an allowed upload over the real route and audits the private-file access', async () => {
  await t.grant();
  const bytes = await t.workbook();
  const fileId = await t.upload(bytes, t.secondUserId);
  const res = await t.h.send('POST', `/v1/businesses/${t.business}/services/import/previews`, {
    cookie: t.cookie,
    company: t.company,
    body: { file_id: fileId },
  });
  expect(res.status).toBe(201);
  expect(res.body['row_count']).toBe(1);
  expect(res.body['error_count']).toBe(0);
  const audits =
    await t.h.owner`SELECT action FROM audit_log WHERE company_id=${t.company} AND entity='file' AND entity_id=${fileId} AND action='access'`;
  expect(audits).toHaveLength(1);
});

it('hides a file created by another member of the same business behind IMPORT_FILE_NOT_FOUND', async () => {
  await t.grant();
  const bytes = await t.workbook();
  const fileId = await t.upload(bytes, t.userId);
  const res = await t.h.send('POST', `/v1/businesses/${t.business}/services/import/previews`, {
    cookie: t.cookie,
    company: t.company,
    body: { file_id: fileId },
  });
  expect(res.status).toBe(404);
  expect(res.body['code']).toBe('IMPORT_FILE_NOT_FOUND');
});
