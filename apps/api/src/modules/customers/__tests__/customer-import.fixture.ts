import type { AuthService } from '@pospay/auth';
import { createDatabase, type Tx } from '@pospay/db';
import { systemUuidV7 } from '@pospay/ids';
import { createLogger } from '@pospay/observability';
import { FILE_UPLOAD_POLICY } from '@pospay/storage';
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
import { refusingStaffSessions } from '../../../../test/refusing-staff-sessions.ts';
import { createApp } from '../../../app.ts';
import {
  CUSTOMER_IMPORT_COLUMNS,
  type CustomerImportFileFacts,
} from '../domain/customer-import.ts';
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
export async function customerWorkbook(
  rows: readonly ImportRow[],
  headers: readonly string[] = CUSTOMER_IMPORT_COLUMNS,
): Promise<Uint8Array> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('customers');
  headers.forEach((header, index) => {
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

/** يبني مصادقة اختبارية تحوّل sid=manager وsid=member إلى مستخدمي مساحة الاختبار. */
function makeFakeAuth(
  ids: ReturnType<typeof systemUuidV7>,
  userId: string,
  memberId: string,
): AuthService {
  const users: Record<string, string> = { manager: userId, member: memberId };
  return {
    preferences: {} as AuthService['preferences'],
    members: {} as AuthService['members'],
    personal: {} as AuthService['personal'],
    passkeys: {} as AuthService['passkeys'],
    privateView: {} as AuthService['privateView'],
    staffUsers: {
      provision: async () => ({ userId: '' }),
      changePhone: async () => undefined,
      deleteSessions: async () => undefined,
      cancel: async () => undefined,
      read: async () => null,
      isStaffUser: async () => false,
      staffCompanyOf: async () => null,
      bindingOf: async () => null,
      userIdForResetToken: async () => null,
      close: async () => undefined,
    },
    staff: refusingStaffSessions,
    handler: async () => new Response(null, { status: 404 }),
    getSession: async (headers) => {
      const uid = users[/sid=([\w-]+)/.exec(headers.get('cookie') ?? '')?.[1] ?? ''];
      return uid === undefined
        ? null
        : {
            userId: uid,
            sessionId: ids.newId(),
            activeCompanyId: null,
            platformPermissions: [],
            setCookies: [],
          };
    },
    provisionUser: async () => userId,
    hashPassword: async () => 'synthetic-hash',
    issuePasswordSetLink: async () => 'http://api.test/unused',
    recordPlatformAction: async () => undefined,
    discardUser: async () => undefined,
    ping: async () => undefined,
    close: async () => undefined,
  };
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

function memoryObjectStorage(storage: Map<string, Uint8Array>) {
  return {
    presignUpload: async () => '',
    presignDownload: async () => '',
    read: (key: string, maxBytes: number): Promise<Uint8Array> => {
      const found = storage.get(key);
      return found === undefined
        ? Promise.reject(new Error('STORAGE_UNAVAILABLE'))
        : Promise.resolve(found.subarray(0, maxBytes));
    },
    put: async (key: string, bytes: Uint8Array) => void storage.set(key, bytes),
    remove: async (key: string) => void storage.delete(key),
    close: () => undefined,
  };
}

function appBoot(
  db: ReturnType<typeof createDatabase>,
  ids: ReturnType<typeof systemUuidV7>,
  auth: AuthService,
  clockPort: { now: () => Date },
  objectStorage: ReturnType<typeof memoryObjectStorage>,
) {
  return (withFiles = true) =>
    createApp(
      {
        readiness: [],
        auth: { service: auth, baseURL: 'http://api.test' },
        database: db,
        ids,
        customersClock: clockPort,
        ...(withFiles
          ? {
              files: {
                storage: objectStorage,
                policy: FILE_UPLOAD_POLICY,
                queue: { enqueue: async () => undefined },
              },
            }
          : {}),
      },
      { logger: createLogger('silent') },
    );
}

type FactsRow = { [K in keyof CustomerImportFileFacts]: CustomerImportFileFacts[K] };

async function testFileFacts(
  tx: Tx,
  companyId: string,
  fileId: string,
): Promise<CustomerImportFileFacts | null> {
  const [row] = await tx.execute<FactsRow>(sql`
    SELECT business_id,created_by,owner_module,content_type,size_bytes::int AS size_bytes,status,
      CASE WHEN status='READY' THEN storage_key END AS storage_key,
      purged_at IS NOT NULL AS purged, purge_started_at IS NOT NULL AS purge_started
    FROM file_objects WHERE company_id=${companyId} AND id=${fileId}`);
  return row ?? null;
}

function importUseCases(
  db: ReturnType<typeof createDatabase>,
  binding: ReturnType<typeof bindCustomerImportFiles>,
  ids: ReturnType<typeof systemUuidV7>,
  clockPort: { now: () => Date },
) {
  if (binding.bytes === null) throw new Error('STORAGE_UNAVAILABLE');
  const transactions = createCustomerImportTransactions(db, binding, ids);
  return {
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
  };
}

async function buildFixture(
  testDb: Awaited<ReturnType<typeof createTestDatabase>>,
  owner: postgres.Sql,
  db: ReturnType<typeof createDatabase>,
  ids: ReturnType<typeof systemUuidV7>,
  workspace: Awaited<ReturnType<typeof seedImportWorkspace>>,
) {
  const storage = new Map<string, Uint8Array>();
  const clock = { value: new Date('2026-11-26T10:00:00Z') };
  const clockPort = { now: () => clock.value };
  const objectStorage = memoryObjectStorage(storage);
  const binding = bindCustomerImportFiles(objectStorage, testFileFacts);
  const startHttpApp = appBoot(
    db,
    ids,
    makeFakeAuth(ids, workspace.userId, workspace.ownerUserId),
    clockPort,
    objectStorage,
  );
  const app = await startHttpApp(true);
  const useCases = importUseCases(db, binding, ids, clockPort);
  return {
    owner,
    db,
    app,
    startHttpApp,
    ...workspace,
    clock,
    storage,
    ...useCases,
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
      await app.close();
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
    return await buildFixture(testDb, owner, db, ids, workspace);
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
