import postgres from 'postgres';
import { sql } from 'drizzle-orm';
import { createDatabase, type ClaimedEvent } from '@pospay/db';
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
import { packageWorkbook, SYNTHETIC_PHONE } from './package-preview.fixture.ts';

export interface PackageImportCommitComposedFixture {
  db: ReturnType<typeof createDatabase>;
  owner: postgres.Sql;
  ids: ReturnType<typeof systemUuidV7>;
  bytes: Map<string, Uint8Array>;
  clock: { now: () => Date };
  membership: string;
  company: string;
  business: string;
  otherCompany: string;
  dispatcherUrl: string;
  worker: ExecutePackagePreview;
  requested(content: Uint8Array): Promise<{ id: string; file: string; key: string }>;
  commitRequested(prefix: string): Promise<string>;
  commitEvent(previewId: string, overrides?: Partial<ClaimedEvent>): ClaimedEvent;
  moneyCounts(previewId: string): Promise<{
    entitlements: number | undefined;
    slots: number | undefined;
    audits: number | undefined;
    events: number | undefined;
  }>;
  close(): Promise<void>;
}

/** ينشئ قاعدة اختبار معزولة بمسار dispatcher حقيقي لتجربة تسليم outbox الحية مع تثبيت استيراد حقيقي. */
export async function packageImportCommitComposedFixture(): Promise<PackageImportCommitComposedFixture> {
  const testDb = await createTestDatabase();
  await seedTwoTenants(testDb.ownerUrl);
  const owner = postgres(testDb.ownerUrl, { max: 4, onnotice: () => undefined });
  const ids = systemUuidV7();
  const db = createDatabase({ url: testDb.appUrl, ids });
  const bytes = new Map<string, Uint8Array>();
  await owner`INSERT INTO "user"(id,name,email) VALUES(${USER},'Synthetic commit requester','worker-commit@example.test') ON CONFLICT(id) DO NOTHING`;
  await owner`INSERT INTO customers(company_id,id,name,phone,locale,created_at,updated_at)
    VALUES(${TENANT.A.company},${ids.newId()},'Synthetic customer',${SYNTHETIC_PHONE},'en',now(),now())`;
  for (let index = 0; index < 20; index++)
    await owner`INSERT INTO services(company_id,id,business_id,name_en,price,commission_rule_kind)
      VALUES(${TENANT.A.company},${ids.newId()},${TENANT.A.business},${`Service ${index}`},'9.000','FOLLOW_PLAN')`;
  const membership = ids.newId();
  const [role] = await owner`SELECT id FROM roles WHERE company_id IS NULL AND code='owner'`;
  await owner`INSERT INTO memberships(company_id,id,user_id,role_id,role_owner_key,scope_type,scope_id)
    VALUES(${TENANT.A.company},${membership},${USER},${role?.['id']},'global','COMPANY',${TENANT.A.company})`;
  const worker = new ExecutePackagePreview(
    packagePreviewTransactions(db),
    packagePreviewWorkbook(async (key: string) => bytes.get(key) ?? null),
    { now: () => new Date('2026-11-05T12:00:00Z') },
  );
  const f: PackageImportCommitComposedFixture = {
    db,
    owner,
    ids,
    bytes,
    clock: { now: () => new Date('2026-11-05T12:00:00Z') },
    membership,
    company: TENANT.A.company,
    business: TENANT.A.business,
    otherCompany: TENANT.B.company,
    dispatcherUrl: testDb.dispatcherUrl,
    worker,
    requested: (content) => insertRequestedRow(f, content),
    commitRequested: (prefix) => buildCommitRequested(f, prefix),
    commitEvent: (previewId, overrides = {}) => makeCommitEvent(f, previewId, overrides),
    moneyCounts: (previewId) => readMoneyCounts(f, previewId),
    close: async () => {
      await db.close();
      await owner.end();
      await testDb.drop();
    },
  };
  return f;
}

/** يسجل ملفًا جاهزًا ومعاينة pending تقرأ بايتاته من الذاكرة. */
async function insertRequestedRow(
  f: PackageImportCommitComposedFixture,
  content: Uint8Array,
): Promise<{ id: string; file: string; key: string }> {
  const id = f.ids.newId();
  const file = f.ids.newId();
  const key = `verified/${file}`;
  f.bytes.set(key, content);
  await f.owner`INSERT INTO file_objects(company_id,id,business_id,owner_module,owner_entity_id,staging_key,storage_key,
    content_type,size_bytes,required_permission,created_by,created_at,status)
    VALUES(${f.company},${file},${f.business},'orders',${f.business},${`staging/${file}`},${key},
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',${content.length},'import:packages:business',${USER},now(),'READY')`;
  await f.owner`INSERT INTO import_previews(company_id,id,business_id,entity,file_id,created_by,created_at,expires_at,status,row_count,error_count,rows,errors)
    VALUES(${f.company},${id},${f.business},'packages',${file},${USER},'2026-11-05T10:00:00Z','2026-11-06T10:00:00Z','pending',0,0,'[]','[]')`;
  return { id, file, key };
}

/** يبني معاينة مقبولة في حالة commit_requested بلحظة قبول ثابتة على ساعة الـ fixture. */
async function buildCommitRequested(f: PackageImportCommitComposedFixture, prefix: string) {
  const { id } = await insertRequestedRow(f, await packageWorkbook(1, 2, prefix));
  await f.worker.execute(f.company, id);
  await f.db.withTenant(f.company, async (tx) => {
    await tx.execute(
      sql`UPDATE import_previews SET status='commit_requested',requested_at='2026-11-05T12:00:00Z',commit_membership_id=${f.membership} WHERE id=${id}`,
    );
  });
  return id;
}

/** يقرأ عدّادات الأثر المالي للمعاينة: الاستحقاقات والجلسات والتدقيق وأحداث outbox. */
async function readMoneyCounts(f: PackageImportCommitComposedFixture, previewId: string) {
  const [entitlements] =
    await f.owner`SELECT count(*)::int AS n FROM package_entitlements WHERE import_batch_id=${previewId}`;
  const [slots] = await f.owner`SELECT count(*)::int AS n FROM package_session_slots s
    JOIN package_entitlements e ON e.company_id=s.company_id AND e.id=s.entitlement_id
    WHERE e.import_batch_id=${previewId}`;
  const [audits] =
    await f.owner`SELECT count(*)::int AS n FROM audit_log WHERE entity_id=${previewId} AND action='import.committed'`;
  const [events] =
    await f.owner`SELECT count(*)::int AS n FROM outbox WHERE aggregate_id=${previewId} AND event_type='ImportCommitted'`;
  return {
    entitlements: entitlements?.['n'] as number | undefined,
    slots: slots?.['n'] as number | undefined,
    audits: audits?.['n'] as number | undefined,
    events: events?.['n'] as number | undefined,
  };
}

/** حدث PackageImportCommitRequested بمعرفات المستأجر والمعاينة. */
function makeCommitEvent(
  f: PackageImportCommitComposedFixture,
  previewId: string,
  overrides: Partial<ClaimedEvent> = {},
): ClaimedEvent {
  return {
    companyId: f.company,
    id: f.ids.newId(),
    aggregateId: previewId,
    aggregateType: 'import_preview',
    eventType: 'PackageImportCommitRequested',
    payload: { preview_id: previewId },
    attempt: 1,
    ...overrides,
  };
}
