import { systemUuidV7 } from '@pospay/ids';
import { afterAll, beforeAll, expect, it } from 'vitest';

import { startHarness, type Harness } from '../../../../test/harness.ts';
import { SERVICE_IMPORT_TEMPLATE_HEADERS } from '../domain/service-import-template.ts';

// مسارات استيراد الخدمات عبر HTTP الحقيقي: الحراسة والراية والملفات الإنتاجية كلها في الطريق
// (MEDIUM مراجعة 1186: اختبارات القبول الأربعة — مسموح، بلا جلسة، بلا صلاحية، الراية مقفولة).

const ids = systemUuidV7();
const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** تخزين ذاكري صغير يقرأه ربط الاستيراد الإنتاجي عبر ObjectStorage.read نفسه. */
function memoryStorage() {
  const objects = new Map<string, Uint8Array>();
  return {
    presignUpload: () => Promise.resolve('http://storage.test/upload'),
    presignDownload: () => Promise.resolve('http://storage.test/download'),
    read: (key: string, maxBytes: number) => {
      const found = objects.get(key);
      if (found === undefined) return Promise.reject(new Error('STORAGE_UNAVAILABLE'));
      return Promise.resolve(found.subarray(0, maxBytes));
    },
    put: (key: string, bytes: Uint8Array) => {
      objects.set(key, bytes);
    },
    close: () => undefined,
  };
}

let h: Harness;
let company: string;
let business: string;
let cookie: string;
let userId: string;
let secondUserId: string;
let storage: ReturnType<typeof memoryStorage>;

const harnessOptions = () =>
  ({
    files: {
      storage,
      policy: { allowed: () => Promise.resolve(true) },
      queue: { enqueue: () => Promise.resolve() },
    },
  }) as unknown as Parameters<typeof startHarness>[0];

async function upload(content: Uint8Array, createdBy: string): Promise<string> {
  const fileId = ids.newId();
  const storageKey = `verified/${ids.newId()}`;
  storage.put(storageKey, content);
  await h.owner`INSERT INTO file_objects
    (company_id,id,business_id,owner_module,owner_entity_id,staging_key,storage_key,content_type,size_bytes,required_permission,created_by,created_at,status)
    VALUES (${company},${fileId},${business},'catalog',${business},${`staging/${fileId}`},${storageKey},
      ${XLSX},${content.byteLength},'read:files:business',${createdBy},now(),'READY')`;
  return fileId;
}

const workbook = (): Promise<Uint8Array> =>
  import('exceljs').then(async (ExcelJS) => {
    const book = new ExcelJS.Workbook();
    const sheet = book.addWorksheet('services');
    SERVICE_IMPORT_TEMPLATE_HEADERS.forEach((header, index) => {
      sheet.getCell(1, index + 1).value = header;
    });
    sheet.getCell(2, 1).value = 'HTTP Imported';
    sheet.getCell(2, 3).value = 1;
    return new Uint8Array(await book.xlsx.writeBuffer());
  });

beforeAll(async () => {
  storage = memoryStorage();
  h = await startHarness(harnessOptions());
  const ownerCookie = await h.signedInOperator('import-http-owner@example.test');
  cookie = await h.signedInOperator('import-http-manager@example.test');
  company = await h.onboard(ownerCookie, 'Import HTTP employer');
  const [owner] = await h.owner`SELECT id FROM "user" WHERE email='import-http-owner@example.test'`;
  const [manager] = await h.owner`SELECT id FROM "user" WHERE email='import-http-manager@example.test'`;
  userId = owner?.['id'] as string;
  secondUserId = manager?.['id'] as string;
  business = ids.newId();
  await h.owner`INSERT INTO businesses (company_id,id,name_en,vertical_type) VALUES (${company},${business},'Import HTTP business','salon')`;
  // عضوية المدير في نفس الشركة بصلاحية ممنوحة لاحقاً في كل حالة (نمط SC-01).
  const role = ids.newId();
  const memberId = ids.newId();
  await h.owner`INSERT INTO roles(id,company_id,code,name_en)
    VALUES (${role},${company},'import_http_manager','Import HTTP manager')`;
  await h.owner`INSERT INTO memberships(company_id,id,user_id,role_id,role_owner_key,scope_type,scope_id)
    VALUES (${company},${memberId},${secondUserId},${role},${company},'COMPANY',${company})`;
});

afterAll(async () => {
  await h?.close();
});

const grant = async (): Promise<void> => {
  const [membership] =
    await h.owner`SELECT id FROM memberships WHERE company_id=${company} AND user_id=${secondUserId}`;
  await h.owner`INSERT INTO permission_overrides
    (company_id,id,membership_id,permission_code,effect,scope_type,scope_id,reason,granted_by)
    VALUES (${company},${ids.newId()},${membership?.['id'] as string},'manage:services:business','ALLOW','BUSINESS',${business},'HTTP test grant',${userId})`;
};

const revoke = async (): Promise<void> => {
  await h.owner`DELETE FROM permission_overrides WHERE company_id=${company} AND permission_code='manage:services:business'`;
};

it('answers the template over the real route for an allowed session', async () => {
  await grant();
  const res = await h.send('GET', `/v1/businesses/${business}/services/import/template`, {
    cookie,
    company,
  });
  expect(res.status).toBe(200);
  expect(res.body['content_type']).toBe(XLSX);
  expect(String(res.body['content_base64']).length).toBeGreaterThan(100);
  await revoke();
});

it('demands a session before anything else', async () => {
  const res = await h.app.inject({
    method: 'GET',
    url: `/v1/businesses/${business}/services/import/template`,
    headers: { 'x-company-id': company },
  });
  expect(res.statusCode).toBe(401);
});

it('denies a member without the manage permission with the exact envelope', async () => {
  await revoke();
  const res = await h.send('GET', `/v1/businesses/${business}/services/import/template`, {
    cookie,
    company,
  });
  expect(res.status).toBe(403);
  expect(res.body['code']).toBe('FORBIDDEN');
});

it('denies every route while the catalog feature is disabled, then recovers', async () => {
  await grant();
  await h.owner`INSERT INTO company_feature_overrides(company_id,flag,enabled,reason,set_by)
    VALUES (${company},'catalog',false,'HTTP test',${userId})`;
  try {
    const template = await h.send('GET', `/v1/businesses/${business}/services/import/template`, {
      cookie,
      company,
    });
    expect(template.status).toBe(403);
    expect(template.body['code']).toBe('FEATURE_DISABLED');
    const bytes = await workbook();
    const fileId = await upload(bytes, userId);
    const preview = await h.send('POST', `/v1/businesses/${business}/services/import/previews`, {
      cookie,
      company,
      body: { file_id: fileId },
    });
    expect(preview.status).toBe(403);
    expect(preview.body['code']).toBe('FEATURE_DISABLED');
  } finally {
    await h.owner`DELETE FROM company_feature_overrides WHERE company_id=${company} AND flag='catalog'`;
  }
});

it('previews an allowed upload over the real route and audits the private-file access', async () => {
  await grant();
  const bytes = await workbook();
  const fileId = await upload(bytes, secondUserId);
  const res = await h.send('POST', `/v1/businesses/${business}/services/import/previews`, {
    cookie,
    company,
    body: { file_id: fileId },
  });
  expect(res.status).toBe(201);
  expect(res.body['row_count']).toBe(1);
  expect(res.body['error_count']).toBe(0);
  const audits =
    await h.owner`SELECT action FROM audit_log WHERE company_id=${company} AND entity='file' AND entity_id=${fileId} AND action='access'`;
  expect(audits).toHaveLength(1);
});

it('hides a file created by another member of the same business behind IMPORT_FILE_NOT_FOUND', async () => {
  await grant();
  const bytes = await workbook();
  const fileId = await upload(bytes, userId);
  const res = await h.send('POST', `/v1/businesses/${business}/services/import/previews`, {
    cookie,
    company,
    body: { file_id: fileId },
  });
  expect(res.status).toBe(404);
  expect(res.body['code']).toBe('IMPORT_FILE_NOT_FOUND');
});
