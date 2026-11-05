import { AsyncLocalStorage } from 'node:async_hooks';
import postgres from 'postgres';
import ExcelJS from 'exceljs';
import { createDatabase, type TenantWrappers } from '@pospay/db';
import { systemUuidV7 } from '@pospay/ids';
import { createTestDatabase } from '../../../../../../packages/db/test/test-database.ts';
import {
  seedTwoTenants,
  TENANT,
  USER,
} from '../../../../../../packages/db/test/tenancy-fixtures.ts';
import { ExecutePackagePreview } from '../use-cases/execute-package-preview/execute-package-preview.ts';
import { packagePreviewTransactions } from '../persistence/package-preview.transactions.ts';
import { packagePreviewWorkbook } from '../persistence/package-preview-workbook.ts';
import { PACKAGE_IMPORT_HEADERS } from '../domain/package-import-row.ts';

export const SYNTHETIC_PHONE = '+99912345678';

export async function packageWorkbook(count = 1, groups = 2, prefix = 'preview') {
  const book = new ExcelJS.Workbook();
  const sheet = book.addWorksheet('packages');
  sheet.addRow([...PACKAGE_IMPORT_HEADERS]);
  for (let index = 0; index < count; index++)
    sheet.addRow([
      SYNTHETIC_PHONE,
      'Synthetic package',
      null,
      '10.001',
      '2020-01-01',
      `${prefix}-${index}`,
      ...Array.from({ length: groups }, (_, group) => [`Service ${group}`, 365, 364]).flat(),
    ]);
  return new Uint8Array(await book.xlsx.writeBuffer());
}

export async function editPackageWorkbook(
  bytes: Uint8Array,
  edit: (sheet: ExcelJS.Worksheet) => void,
) {
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(Buffer.from(bytes) as unknown as Parameters<typeof book.xlsx.load>[0]);
  const sheet = book.worksheets[0];
  if (sheet === undefined) throw new Error('Synthetic workbook missing sheet');
  edit(sheet);
  return new Uint8Array(await book.xlsx.writeBuffer());
}

async function prepare(owner: postgres.Sql, ids: ReturnType<typeof systemUuidV7>) {
  await owner`INSERT INTO "user"(id,name,email) VALUES(${USER},'Synthetic preview requester','worker-preview@example.test') ON CONFLICT(id) DO NOTHING`;
  const customer = ids.newId();
  await owner`INSERT INTO customers(company_id,id,name,phone,locale,created_at,updated_at)
    VALUES(${TENANT.A.company},${customer},'Synthetic customer',${SYNTHETIC_PHONE},'en',now(),now())`;
  for (let index = 0; index < 20; index++)
    await owner`INSERT INTO services(company_id,id,business_id,name_en,price,commission_rule_kind)
    VALUES(${TENANT.A.company},${ids.newId()},${TENANT.A.business},${`Service ${index}`},'9.000','FOLLOW_PLAN')`;
  const [guard] =
    await owner`SELECT pg_get_functiondef('package_import_preview_update_guard()'::regprocedure) AS definition`;
  if (!(guard?.['definition'] as string).includes('IMPORT_PREVIEW_READY_RESULTS_INVALID'))
    throw new Error('PACKAGE_PREVIEW_FINAL_MIGRATION_REQUIRED');
}

export async function packagePreviewFixture() {
  const testDb = await createTestDatabase();
  await seedTwoTenants(testDb.ownerUrl);
  const owner = postgres(testDb.ownerUrl, { max: 4, onnotice: () => undefined });
  const ids = systemUuidV7();
  const db = createDatabase({ url: testDb.appUrl, ids });
  await prepare(owner, ids);
  const transactionContext = new AsyncLocalStorage<boolean>();
  const database: Pick<TenantWrappers, 'withTenant'> = {
    withTenant: (companyId, work, options) =>
      db.withTenant(
        companyId,
        async (tx) => {
          return transactionContext.run(true, () => work(tx));
        },
        options,
      ),
  };
  const bytes = new Map<string, Uint8Array>();
  const readBytes = async (key: string) => {
    if (transactionContext.getStore() === true) throw new Error('PROVIDER_INSIDE_TRANSACTION');
    return bytes.get(key) ?? null;
  };
  const clock = { now: () => new Date('2026-11-05T12:00:00Z') };
  return {
    db,
    database,
    owner,
    ids,
    bytes,
    readBytes,
    clock,
    company: TENANT.A.company,
    business: TENANT.A.business,
    otherCompany: TENANT.B.company,
    worker: new ExecutePackagePreview(
      packagePreviewTransactions(database),
      packagePreviewWorkbook(readBytes),
      clock,
    ),
    requested: (content: Uint8Array) => requested(owner, ids, bytes, content),
    close: async () => {
      await db.close();
      await owner.end();
      await testDb.drop();
    },
  };
}

async function requested(
  owner: postgres.Sql,
  ids: ReturnType<typeof systemUuidV7>,
  bytes: Map<string, Uint8Array>,
  content: Uint8Array,
) {
  const id = ids.newId();
  const file = ids.newId();
  const key = `verified/${file}`;
  bytes.set(key, content);
  await owner`INSERT INTO file_objects(company_id,id,business_id,owner_module,owner_entity_id,staging_key,storage_key,
    content_type,size_bytes,required_permission,created_by,created_at,status)
    VALUES(${TENANT.A.company},${file},${TENANT.A.business},'orders',${TENANT.A.business},${`staging/${file}`},${key},
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',${content.length},'import:packages:business',${USER},now(),'READY')`;
  await owner`INSERT INTO import_previews(company_id,id,business_id,entity,file_id,created_by,created_at,expires_at,status,row_count,error_count,rows,errors)
    VALUES(${TENANT.A.company},${id},${TENANT.A.business},'packages',${file},${USER},'2026-11-05T10:00:00Z','2026-11-06T10:00:00Z','pending',0,0,'[]','[]')`;
  return { id, file, key };
}

export type PackagePreviewFixture = Awaited<ReturnType<typeof packagePreviewFixture>>;
