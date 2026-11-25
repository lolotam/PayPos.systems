import { expect, it } from 'vitest';

import { createServiceImportHttpHarness, ids } from './service-import-http.harness.ts';

// قبول معاينة استيراد الخدمات عبر HTTP الحقيقي: الإيدمبوتنسي والصلاحية والجهاز والراية
// وحالات الرفض (منتهية، بأخطاء، نشاط آخر، كيان آخر، صاحب آخر) كلها من الطريق الإنتاجي.

const t = createServiceImportHttpHarness();

/** يطلب القبول بمفتاح إيدمبوتنسي لمعاينة محددة بجلسة المدير. */
const commit = (previewId: string, key: string) =>
  t.h.send('POST', t.commitRoute(), {
    cookie: t.cookie,
    company: t.company,
    key,
    body: { preview_id: previewId },
  });

it('accepts a commit over the real route and moves the preview to commit_requested', async () => {
  await t.grant();
  const previewId = await t.commitPreview();
  const res = await commit(previewId, `commit-${previewId}`);
  expect(res.status).toBe(202);
  expect(res.body['preview_id']).toBe(previewId);
  const [row] =
    await t.h.owner`SELECT status FROM import_previews WHERE company_id=${t.company} AND id=${previewId}`;
  expect(row?.['status']).toBe('commit_requested');
  await t.revoke();
});

it('demands an Idempotency-Key before touching the preview', async () => {
  await t.grant();
  const previewId = await t.commitPreview();
  const res = await t.h.send('POST', t.commitRoute(), {
    cookie: t.cookie,
    company: t.company,
    body: { preview_id: previewId },
  });
  expect(res.status).toBe(400);
  expect(res.body['code']).toBe('IDEMPOTENCY_KEY_REQUIRED');
  await t.revoke();
});

it('refuses a reused key that carries another request', async () => {
  await t.grant();
  const first = await t.commitPreview();
  const second = await t.commitPreview();
  const key = `reused-${first}`;
  expect((await commit(first, key)).status).toBe(202);
  const res = await commit(second, key);
  expect(res.status).toBe(422);
  expect(res.body['code']).toBe('IDEMPOTENCY_KEY_REUSED');
  await t.revoke();
});

it('refuses a commit without the manage permission', async () => {
  await t.revoke();
  const previewId = await t.commitPreview();
  const res = await commit(previewId, `forbidden-${previewId}`);
  expect(res.status).toBe(403);
  expect(res.body['code']).toBe('FORBIDDEN');
});

it('refuses a commit from a device session', async () => {
  await t.grant();
  const branch = ids.newId();
  await t.h.owner`INSERT INTO branches (company_id,id,business_id,name_en)
    VALUES (${t.company},${branch},${t.business},'Import HTTP branch')`;
  const pairing = await t.h.send('POST', `/v1/branches/${branch}/devices/pairing-code`, {
    cookie: t.ownerCookie,
    company: t.company,
  });
  const registered = await t.h.app.inject({
    method: 'POST',
    url: '/v1/devices/register',
    payload: { pairing_code: pairing.body['code'], label: 'Import HTTP device' },
  });
  const device = registered.json() as { device_id: string; claim_secret: string };
  await t.h.send('POST', `/v1/branches/${branch}/devices/${device.device_id}/approve`, {
    cookie: t.ownerCookie,
    company: t.company,
  });
  const claimed = await t.h.app.inject({
    method: 'POST',
    url: '/v1/devices/claim',
    payload: {
      company_id: t.company,
      device_id: device.device_id,
      claim_secret: device.claim_secret,
    },
  });
  const token = (claimed.json() as { device_token: string }).device_token;
  const previewId = await t.commitPreview();
  const res = await t.h.app.inject({
    method: 'POST',
    url: t.commitRoute(),
    headers: {
      authorization: `Device ${token}`,
      'x-company-id': t.company,
      'idempotency-key': `device-${previewId}`,
    },
    payload: { preview_id: previewId },
  });
  expect(res.statusCode).toBe(403);
  await t.revoke();
});

it('refuses every commit while the catalog feature is disabled', async () => {
  await t.grant();
  await t.h.owner`INSERT INTO company_feature_overrides(company_id,flag,enabled,reason,set_by)
    VALUES (${t.company},'catalog',false,'HTTP test',${t.userId})`;
  try {
    const previewId = await t.commitPreview();
    const res = await commit(previewId, `feature-${previewId}`);
    expect(res.status).toBe(403);
    expect(res.body['code']).toBe('FEATURE_DISABLED');
  } finally {
    await t.h.owner`DELETE FROM company_feature_overrides WHERE company_id=${t.company} AND flag='catalog'`;
    await t.revoke();
  }
});

it('refuses an expired preview over the real route (SIT-06)', async () => {
  await t.grant();
  const previewId = await t.commitPreview({ expiresAt: '2021-01-01T00:00:00Z' });
  const res = await commit(previewId, `expired-${previewId}`);
  expect(res.status).toBe(409);
  expect(res.body['code']).toBe('IMPORT_PREVIEW_EXPIRED');
  await t.revoke();
});

it('refuses a preview carrying row errors over the real route (SIT-06)', async () => {
  await t.grant();
  const previewId = await t.commitPreview({
    errorCount: 1,
    errors: [{ row: 2, column: 'price', code: 'IMPORT_PRICE_INVALID' }],
  });
  const res = await commit(previewId, `dirty-${previewId}`);
  expect(res.status).toBe(409);
  expect(res.body['code']).toBe('IMPORT_PREVIEW_HAS_ERRORS');
  await t.revoke();
});

it('refuses a preview of another business of the same company over the real route', async () => {
  await t.grant();
  const otherBusiness = ids.newId();
  await t.h.owner`INSERT INTO businesses (company_id,id,name_en,vertical_type)
    VALUES (${t.company},${otherBusiness},'Import HTTP other business','salon')`;
  const previewId = await t.commitPreview({ businessId: otherBusiness });
  const res = await commit(previewId, `other-business-${previewId}`);
  expect(res.status).toBe(404);
  expect(res.body['code']).toBe('IMPORT_PREVIEW_NOT_FOUND');
  await t.revoke();
});

it('refuses a preview of another entity over the real route', async () => {
  await t.grant();
  const previewId = await t.commitPreview({ entity: 'employees' });
  const res = await commit(previewId, `other-entity-${previewId}`);
  expect(res.status).toBe(404);
  expect(res.body['code']).toBe('IMPORT_PREVIEW_NOT_FOUND');
  await t.revoke();
});

it('refuses a preview created by another member over the real route', async () => {
  await t.grant();
  const previewId = await t.commitPreview({ createdBy: t.userId });
  const res = await commit(previewId, `other-creator-${previewId}`);
  expect(res.status).toBe(404);
  expect(res.body['code']).toBe('IMPORT_PREVIEW_NOT_FOUND');
  await t.revoke();
});
