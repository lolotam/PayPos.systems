import postgres from 'postgres';
import { createDatabase } from '@pospay/db';
import { systemUuidV7 } from '@pospay/ids';
import { createTestDatabase } from '../../../../../../packages/db/test/test-database.ts';
import {
  seedTwoTenants,
  TENANT,
  USER,
} from '../../../../../../packages/db/test/tenancy-fixtures.ts';
import { CommitServiceImport } from '../use-cases/commit-service-import/commit-service-import.ts';
import { serviceImportCommitTransactions } from '../persistence/service-import-commit.transactions.ts';
import type { ServiceImportNormalizedRow } from '../domain/service-import-commit.ts';

/** صف معاينة مطبّع واحد جاهز للالتزام، بترقيم الورقة الأصلي (A-12). */
export function normalizedRow(
  nameEn: string,
  options: { row?: number; categoryId?: string | null; price?: string } = {},
): ServiceImportNormalizedRow {
  return {
    row: options.row ?? 2,
    name_en: nameEn,
    name_ar: null,
    price: options.price ?? '12.500',
    duration_minutes: null,
    category_id: options.categoryId === undefined ? null : options.categoryId,
    category_name_en: null,
    commission_rule: { kind: 'FOLLOW_PLAN' },
    counts_toward_threshold: true,
  };
}

/** مستخدم قاعدة الاختبار ومستأجراه ثابتان؛ ملفان موثّقان READY لصفوف المعاينة في المستأجرين. */
async function seedCommitWorkspace(testDb: Awaited<ReturnType<typeof createTestDatabase>>) {
  await seedTwoTenants(testDb.ownerUrl);
  const owner = postgres(testDb.ownerUrl, { max: 4, onnotice: () => undefined });
  const ids = systemUuidV7();
  const { company, business } = TENANT.A;
  await owner`INSERT INTO "user"(id,name,email) VALUES(${USER},'Catalog import requester','worker-catalog-import@example.test') ON CONFLICT (id) DO NOTHING`;
  const file = ids.newId();
  const otherFile = ids.newId();
  for (const [tenantCompany, tenantBusiness, fileId] of [
    [company, business, file],
    [TENANT.B.company, TENANT.B.business, otherFile],
  ] as const) {
    await owner`INSERT INTO file_objects(company_id,id,business_id,owner_module,owner_entity_id,staging_key,storage_key,
      content_type,size_bytes,required_permission,created_by,created_at,status)
      VALUES(${tenantCompany},${fileId},${tenantBusiness},'catalog',${tenantBusiness},${`staging/${fileId}`},${`verified/${fileId}`},
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',100,'read:files:business',${USER},now(),'READY')`;
  }
  return { owner, ids, company, business, file, otherFile };
}

/** مساعدات بيانات الالتزام: طلب مقبول وتصنيفات وخدمات وقراءة حالة. */
function commitHelpers(
  owner: ReturnType<typeof postgres>,
  company: string,
  business: string,
  file: string,
  otherFile: string,
  ids: ReturnType<typeof systemUuidV7>,
  clockValue: Date,
) {
  return {
    async requested(
      rows: readonly ServiceImportNormalizedRow[],
      options: {
        status?: string;
        requestedAt?: Date;
        expiresAt?: Date;
        createdAt?: Date;
        errors?: unknown;
        businessId?: string;
        companyId?: string;
      } = {},
    ): Promise<string> {
      const id = ids.newId();
      const foreign = options.companyId !== undefined && options.companyId !== company;
      await owner`INSERT INTO import_previews
        (company_id,id,business_id,entity,file_id,created_by,created_at,expires_at,requested_at,row_count,error_count,rows,errors,status)
        VALUES (${options.companyId ?? company},${id},${options.businessId ?? business},'services',${foreign ? otherFile : file},${USER},
          ${options.createdAt ?? options.requestedAt ?? clockValue},${options.expiresAt ?? new Date(clockValue.getTime() + 86_400_000)},
          ${options.requestedAt ?? clockValue},${rows.length},${Array.isArray(options.errors) ? options.errors.length : 0},
          ${owner.json(rows as unknown as Parameters<typeof owner.json>[0])},
          ${owner.json((options.errors ?? {}) as Parameters<typeof owner.json>[0])},${options.status ?? 'commit_requested'})`;
      return id;
    },
    async category(nameEn: string, closed = false): Promise<string> {
      const id = ids.newId();
      await owner`INSERT INTO service_categories
        (company_id,id,business_id,name_en,name_ar,visibility,owner_branch_id,created_at,updated_at,closed_at)
        VALUES (${company},${id},${business},${nameEn},${`تصنيف ${nameEn}`},'BUSINESS',NULL,now(),now(),${closed ? clockValue : null})`;
      return id;
    },
    async service(nameEn: string): Promise<string> {
      const id = ids.newId();
      await owner`INSERT INTO services
        (company_id,id,business_id,name_en,price,commission_rule_kind,counts_toward_threshold)
        VALUES (${company},${id},${business},${nameEn},'1.000','FOLLOW_PLAN',TRUE)`;
      return id;
    },
    async serviceCount(): Promise<number> {
      const [row] = await owner`SELECT count(*) AS count FROM services WHERE company_id=${company}`;
      return Number(row?.['count']);
    },
    async previewRow(id: string): Promise<Record<string, unknown> | undefined> {
      const [row] =
        await owner`SELECT status,created_count,error_code,committed_at FROM import_previews WHERE company_id=${company} AND id=${id}`;
      return row;
    },
  };
}

export async function serviceImportCommitFixture() {
  const testDb = await createTestDatabase();
  const seed = await seedCommitWorkspace(testDb);
  const db = createDatabase({ url: testDb.appUrl, ids: seed.ids });
  const clock = { value: new Date('2026-11-22T12:00:00Z') };
  const helpers = commitHelpers(seed.owner, seed.company, seed.business, seed.file, seed.otherFile, seed.ids, clock.value);
  return {
    db,
    owner: seed.owner,
    ids: seed.ids,
    clock,
    company: seed.company,
    business: seed.business,
    otherCompany: TENANT.B.company,
    otherBusiness: TENANT.B.business,
    userId: USER,
    worker: new CommitServiceImport(serviceImportCommitTransactions(db, seed.ids), seed.ids, {
      now: () => clock.value,
    }),
    requested: helpers.requested,
    category: helpers.category,
    service: helpers.service,
    serviceCount: helpers.serviceCount,
    previewRow: helpers.previewRow,
    close: async () => {
      await db.close();
      await seed.owner.end();
      await testDb.drop();
    },
  };
}

export type ServiceImportCommitFixture = Awaited<
  ReturnType<typeof serviceImportCommitFixture>
>;
