import { systemUuidV7 } from '@pospay/ids';
import { afterAll, beforeAll } from 'vitest';

import { startHarness, type Harness } from '../../../../test/harness.ts';
import { SERVICE_IMPORT_TEMPLATE_HEADERS } from '../domain/service-import-template.ts';

// عدّة مشتركة لاختبارات استيراد الخدمات عبر HTTP الحقيقي: ملفا المعاينة والقبول يستخدمان
// نفس الشركة والنشاط والعضويتين وتخزين الملفات بدل تكرار الإعداد (MEDIUM مراجعة 1186).

export const ids = systemUuidV7();
export const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

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

/** خيارات معاينة جاهزة للقبول: تتحكم في صاحبها وحالتها وانتهاءها وأخطائها. */
export interface CommitPreviewOptions {
  createdBy?: string;
  businessId?: string;
  entity?: string;
  status?: string;
  expiresAt?: string;
  errorCount?: number;
  errors?: unknown;
}

/** حالة الاختبار: تُملأ في beforeAll وتُقرأ داخل الاختبارات فقط. */
interface HarnessState {
  h: Harness;
  company: string;
  business: string;
  cookie: string;
  ownerCookie: string;
  userId: string;
  secondUserId: string;
}

type Storage = ReturnType<typeof memoryStorage>;

/** يجهّز شركة ونشاطاً وعضوية مدير بلا صلاحية (نمط SC-01) ويملأ الحالة. */
async function bootstrap(s: HarnessState, storage: Storage): Promise<void> {
  s.h = await startHarness({
    files: {
      storage,
      policy: { allowed: () => Promise.resolve(true) },
      queue: { enqueue: () => Promise.resolve() },
    },
  } as unknown as Parameters<typeof startHarness>[0]);
  const { h } = s;
  s.ownerCookie = await h.signedInOperator('import-http-owner@example.test');
  s.cookie = await h.signedInOperator('import-http-manager@example.test');
  s.company = await h.onboard(s.ownerCookie, 'Import HTTP employer');
  const [owner] = await h.owner`SELECT id FROM "user" WHERE email='import-http-owner@example.test'`;
  const [manager] = await h.owner`SELECT id FROM "user" WHERE email='import-http-manager@example.test'`;
  s.userId = owner?.['id'] as string;
  s.secondUserId = manager?.['id'] as string;
  s.business = ids.newId();
  await h.owner`INSERT INTO businesses (company_id,id,name_en,vertical_type) VALUES (${s.company},${s.business},'Import HTTP business','salon')`;
  const role = ids.newId();
  await h.owner`INSERT INTO roles(id,company_id,code,name_en)
    VALUES (${role},${s.company},'import_http_manager','Import HTTP manager')`;
  await h.owner`INSERT INTO memberships(company_id,id,user_id,role_id,role_owner_key,scope_type,scope_id)
    VALUES (${s.company},${ids.newId()},${s.secondUserId},${role},${s.company},'COMPANY',${s.company})`;
}

/** مصنع الصلاحية الممنوحة والمسحوبة لمدير الاختبار على النشاط. */
function permissionOps(s: HarnessState) {
  return {
    grant: async (): Promise<void> => {
      const [membership] =
        await s.h.owner`SELECT id FROM memberships WHERE company_id=${s.company} AND user_id=${s.secondUserId}`;
      await s.h.owner`INSERT INTO permission_overrides
        (company_id,id,membership_id,permission_code,effect,scope_type,scope_id,reason,granted_by)
        VALUES (${s.company},${ids.newId()},${membership?.['id'] as string},'manage:services:business','ALLOW','BUSINESS',${s.business},'HTTP test grant',${s.userId})`;
    },
    revoke: async (): Promise<void> => {
      await s.h.owner`DELETE FROM permission_overrides WHERE company_id=${s.company} AND permission_code='manage:services:business'`;
    },
  };
}

/** مصنع الملفات والمصنفات والمعاينات التي تُزرع مباشرة في قاعدة الاختبار. */
function fixtureOps(s: HarnessState, storage: Storage) {
  const upload = async (content: Uint8Array, createdBy: string): Promise<string> => {
    const fileId = ids.newId();
    const storageKey = `verified/${ids.newId()}`;
    storage.put(storageKey, content);
    await s.h.owner`INSERT INTO file_objects
      (company_id,id,business_id,owner_module,owner_entity_id,staging_key,storage_key,content_type,size_bytes,required_permission,created_by,created_at,status)
      VALUES (${s.company},${fileId},${s.business},'catalog',${s.business},${`staging/${fileId}`},${storageKey},
        ${XLSX},${content.byteLength},'read:files:business',${createdBy},now(),'READY')`;
    return fileId;
  };
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
  const commitPreview = async (options: CommitPreviewOptions = {}): Promise<string> => {
    const id = ids.newId();
    // المفتاح الأجنبي (company_id, file_id) على import_previews يرفض معاينة بلا ملف.
    const creator = options.createdBy ?? s.secondUserId;
    const fileId = await upload(new Uint8Array(1), creator);
    await s.h.owner`INSERT INTO import_previews
      (company_id,id,business_id,entity,file_id,created_by,created_at,expires_at,row_count,error_count,rows,errors,status)
      VALUES (${s.company},${id},${options.businessId ?? s.business},${options.entity ?? 'services'},${fileId},
        ${creator},'2020-01-01T00:00:00Z',${options.expiresAt ?? '2099-01-01T00:00:00Z'},
        1,${options.errorCount ?? 0},'[]'::jsonb,${JSON.stringify(options.errors ?? [])}::jsonb,
        ${options.status ?? 'ready'})`;
    return id;
  };
  return { upload, workbook, commitPreview };
}

/**
 * عدّة الاختبار: تسجّل beforeAll/afterAll في الملف المستدعي وتعيد كائناً تُملأ حقوله
 * (h, company, business, cookie...) بعد beforeAll، فتُقرأ داخل الاختبارات فقط.
 */
export function createServiceImportHttpHarness() {
  const storage = memoryStorage();
  const s = {} as HarnessState;
  beforeAll(() => bootstrap(s, storage));
  afterAll(async () => {
    await s.h?.close();
  });
  return Object.assign(s, permissionOps(s), fixtureOps(s, storage), {
    commitRoute: (): string => `/v1/businesses/${s.business}/services/import/commits`,
  });
}
