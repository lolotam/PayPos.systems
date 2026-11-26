import { createDatabase } from '@pospay/db';
import { systemUuidV7 } from '@pospay/ids';
import { sql } from 'drizzle-orm';
import ExcelJS from 'exceljs';
import { createHash } from 'node:crypto';
import postgres from 'postgres';

import {
  seedTwoTenants,
  TENANT,
  USER,
} from '../../../../../../packages/db/test/tenancy-fixtures.ts';
import { createTestDatabase } from '../../../../../../packages/db/test/test-database.ts';
import { CUSTOMER_IMPORT_COLUMNS } from '../domain/customer-import.ts';
import { createCustomerImportTemplateBuilder } from '../persistence/customer-import-template.ts';
import {
  bindCustomerImportFiles,
  createCustomerImportSheetReader,
  createCustomerImportTransactions,
} from '../persistence/drizzle-customer-import.ts';
import {
  CommitCustomerImportUseCase,
  GetCustomerImportTemplateUseCase,
  PreviewCustomerImportUseCase,
} from '../use-cases/customer-import/customer-import.usecases.ts';

export type ImportRow = readonly (string | number | null)[];

/** يبني مصنف عملاء بعناوينه العشرة وصفوفه، زي الملف الذي يرفعه المستخدم. */
export async function customerWorkbook(rows: readonly ImportRow[]): Promise<Uint8Array> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('customers');
  CUSTOMER_IMPORT_COLUMNS.forEach((header, index) => {
    sheet.getCell(1, index + 1).value = header;
  });
  rows.forEach((row, rowIndex) =>
    row.forEach((value, columnIndex) => {
      if (value !== null) sheet.getCell(rowIndex + 2, columnIndex + 1).value = value;
    }),
  );
  return new Uint8Array(await workbook.xlsx.writeBuffer());
}

/** يزرع شركتين وأنشطة وفرعاً وعضويات بمالكي الاختبار وصلاحيتي الاستيراد على النشاط والفرع. */
export async function seedImportWorkspace(
  owner: postgres.Sql,
  ids: ReturnType<typeof systemUuidV7>,
) {
  const company = TENANT.A.company;
  const otherCompany = TENANT.B.company;
  const business = TENANT.A.business;
  const branch = TENANT.A.branch;
  const otherBusiness = ids.newId();
  const userId = USER;
  const ownerUserId = ids.newId();
  for (const [id, name, email] of [
    [userId, 'Synthetic import manager', 'customer-import-manager@example.test'],
    [ownerUserId, 'Synthetic import owner', 'customer-import-owner@example.test'],
  ] as const) {
    await owner`INSERT INTO "user"(id,name,email) VALUES (${id},${name},${email}) ON CONFLICT(id) DO NOTHING`;
  }
  for (const b of [business, TENANT.B.business] as const) {
    await owner`UPDATE businesses SET settings='{"country":"KW"}'::jsonb WHERE id=${b}`;
  }
  await owner`INSERT INTO businesses (company_id,id,name_en,vertical_type,settings)
    VALUES (${otherCompany},${otherBusiness},'Synthetic other business','salon','{"country":"KW"}')`;
  const roleA = ids.newId();
  const roleB = ids.newId();
  await owner`INSERT INTO roles(id,company_id,code,name_en) VALUES (${roleA},${company},'synthetic_import_manager','Synthetic import manager')`;
  await owner`INSERT INTO roles(id,company_id,code,name_en) VALUES (${roleB},${otherCompany},'synthetic_import_manager','Synthetic import manager')`;
  const memberId = ids.newId();
  for (const [c, m, u, r] of [
    [company, memberId, userId, roleA],
    [company, ids.newId(), ownerUserId, roleA],
    [otherCompany, ids.newId(), userId, roleB],
  ] as const) {
    await owner`INSERT INTO memberships(company_id,id,user_id,role_id,role_owner_key,scope_type,scope_id)
      VALUES (${c},${m},${u},${r},${c},'COMPANY',${c})`;
  }
  for (const [perm, scopeType, scopeId] of [
    ['create:customers:business', 'BUSINESS', business],
    ['create:customers:branch', 'BRANCH', branch],
  ] as const) {
    await owner`INSERT INTO permission_overrides
      (company_id,id,membership_id,permission_code,effect,scope_type,scope_id,reason,granted_by)
      VALUES (${company},${ids.newId()},${memberId},${perm},'ALLOW',${scopeType},${scopeId},'Synthetic import grant',${userId})`;
  }
  return { company, otherCompany, business, otherBusiness, branch, userId, ownerUserId, memberId };
}

type FileFacts = {
  business_id: string;
  created_by: string;
  owner_module: string;
  content_type: string;
  size_bytes: number;
  status: 'PENDING' | 'VERIFYING' | 'READY' | 'REJECTED';
  storage_key: string | null;
  purged: boolean;
  purge_started: boolean;
};

/** قارئ حقائق الملف في الاختبار: يقرأ file_objects على معاملة الشركة نفسها. */
async function readFileFacts(
  db: ReturnType<typeof createDatabase>,
  userId: string,
  companyId: string,
  fileId: string,
): Promise<FileFacts | null> {
  const [row] = await db.withTenant(
    companyId,
    async (tx) =>
      tx.execute<FileFacts>(sql`SELECT business_id,created_by,owner_module,content_type,
        size_bytes::int AS size_bytes,status,
        CASE WHEN status='READY' THEN storage_key END AS storage_key,
        purged_at IS NOT NULL AS purged, purge_started_at IS NOT NULL AS purge_started
        FROM file_objects WHERE company_id=${companyId} AND id=${fileId}`),
    { userId },
  );
  return row ?? null;
}

/** يرفع ملفاً موثّقاً لوحدة files ويخزن بايتاته في الذاكرة. */
async function uploadFile(
  owner: postgres.Sql,
  ids: ReturnType<typeof systemUuidV7>,
  storage: Map<string, Uint8Array>,
  company: string,
  business: string,
  userId: string,
  content: Uint8Array,
  options: { businessId?: string; createdBy?: string } = {},
): Promise<string> {
  const fileId = ids.newId();
  const storageKey = `verified/${ids.newId()}`;
  storage.set(storageKey, content);
  await owner`INSERT INTO file_objects
    (company_id,id,business_id,owner_module,owner_entity_id,staging_key,storage_key,content_type,size_bytes,required_permission,created_by,created_at,status)
    VALUES (${company},${fileId},${options.businessId ?? business},'customers',${business},${`staging/${fileId}`},${storageKey},
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',${content.byteLength},
      'create:customers:business',${options.createdBy ?? userId},now(),'READY')`;
  return fileId;
}

function buildFixture(
  testDb: Awaited<ReturnType<typeof createTestDatabase>>,
  owner: postgres.Sql,
  db: ReturnType<typeof createDatabase>,
  ids: ReturnType<typeof systemUuidV7>,
  workspace: Awaited<ReturnType<typeof seedImportWorkspace>>,
) {
  const storage = new Map<string, Uint8Array>();
  const clock = { value: new Date('2026-11-26T10:00:00Z') };
  const clockPort = { now: () => clock.value };
  const bytes = {
    read: (key: string, maxBytes: number): Promise<Uint8Array> => {
      const found = storage.get(key);
      if (found === undefined) throw new Error('STORAGE_UNAVAILABLE');
      return Promise.resolve(found.subarray(0, maxBytes));
    },
  };
  const binding = bindCustomerImportFiles(bytes, (_tx, companyId, fileId) =>
    readFileFacts(db, workspace.userId, companyId, fileId),
  );
  if (binding.bytes === null) throw new Error('STORAGE_UNAVAILABLE');
  const transactions = createCustomerImportTransactions(db, binding, ids);
  return {
    owner,
    db,
    ...workspace,
    clock,
    storage,
    template: new GetCustomerImportTemplateUseCase(
      transactions,
      createCustomerImportTemplateBuilder(),
    ),
    preview: new PreviewCustomerImportUseCase(
      transactions,
      binding.bytes,
      createCustomerImportSheetReader(),
      ids,
      clockPort,
    ),
    commit: new CommitCustomerImportUseCase(transactions, clockPort),
    upload: (content: Uint8Array, options: { businessId?: string; createdBy?: string } = {}) =>
      uploadFile(
        owner,
        ids,
        storage,
        workspace.company,
        workspace.business,
        workspace.userId,
        content,
        options,
      ),
    close: async () => {
      await db.close();
      await owner.end();
      await testDb.drop();
    },
  };
}

export async function customerImportFixture() {
  const testDb = await createTestDatabase();
  const owner = postgres(testDb.ownerUrl, { max: 2, onnotice: () => undefined });
  const ids = systemUuidV7();
  let db: ReturnType<typeof createDatabase> | undefined;
  try {
    await seedTwoTenants(testDb.ownerUrl);
    const workspace = await seedImportWorkspace(owner, ids);
    db = createDatabase({ url: testDb.appUrl, ids });
    return buildFixture(testDb, owner, db, ids, workspace);
  } catch (error) {
    await db?.close().catch(() => undefined);
    await owner.end().catch(() => undefined);
    await testDb.drop().catch(() => undefined);
    throw error;
  }
}

export type CustomerImportFixture = Awaited<ReturnType<typeof customerImportFixture>>;

/** أمر المعاينة: الشركة والمستخدم والنطاق المستهدف والملف المرفوع. */
export const previewCommand = (
  f: CustomerImportFixture,
  fileId: string,
  kind: 'business' | 'branch' = 'business',
) => ({
  companyId: f.company,
  userId: f.userId,
  scope: { kind, id: kind === 'business' ? f.business : f.branch },
  fileId,
});

/** أمر القبول: المعاينة ومفتاح الـ idempotency وبصمة الطلب. */
export const commitCommand = (f: CustomerImportFixture, previewId: string, key: string) => ({
  companyId: f.company,
  userId: f.userId,
  scope: { kind: 'business' as const, id: f.business },
  previewId,
  key,
  // runIdempotent يتطلب بصمة sha256 سداسية عشرية؛ في الإنتاج يحسبها requestFingerprint.
  fingerprint: createHash('sha256').update(previewId).digest('hex'),
});
