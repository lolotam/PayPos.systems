import { createDatabase, type Tx } from '@pospay/db';
import { systemUuidV7 } from '@pospay/ids';
import ExcelJS from 'exceljs';
import { sql } from 'drizzle-orm';

import { startHarness } from '../../../../test/harness.ts';
import { SERVICE_IMPORT_TEMPLATE_HEADERS } from '../domain/service-import-template.ts';
import type { ServiceImportFileFacts } from '../domain/service-import-file.ts';
import { createServiceImportTransactions } from '../persistence/drizzle-service-import.ts';
import {
  bindServiceImportFiles,
  createServiceImportSheetReader,
} from '../persistence/service-import-adapters.ts';
import { createServiceImportTemplateBuilder } from '../persistence/service-import-template.ts';
import { PreviewServiceImportUseCase } from '../use-cases/preview-service-import/preview-service-import.usecase.ts';
import { GetServiceImportTemplateUseCase } from '../use-cases/get-service-import-template/get-service-import-template.usecase.ts';
import { serviceImportStatusQuery } from '../queries/service-import-status.query.ts';
import { serviceImportRowsPage } from '../queries/service-import-rows.query.ts';

export type ImportRow = readonly (string | number | boolean | null)[];

/** مصنف اختباري بعناوين القالب المرجعية وصفوف يحددها الاختبار، مع تنسيقات أرقام اختيارية لخلية. */
export async function serviceWorkbook(
  rows: readonly ImportRow[],
  options: {
    headers?: readonly string[];
    worksheetName?: string;
    numericFormats?: readonly { readonly row: number; readonly col: number; readonly numFmt: string }[];
  } = {},
): Promise<Uint8Array> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(options.worksheetName ?? 'services');
  (options.headers ?? SERVICE_IMPORT_TEMPLATE_HEADERS).forEach((header, index) => {
    sheet.getCell(1, index + 1).value = header;
  });
  rows.forEach((row, rowIndex) =>
    row.forEach((value, columnIndex) => {
      if (value !== null) sheet.getCell(rowIndex + 2, columnIndex + 1).value = value;
    }),
  );
  for (const format of options.numericFormats ?? []) {
    sheet.getCell(format.row + 2, format.col + 1).numFmt = format.numFmt;
  }
  return new Uint8Array(await workbook.xlsx.writeBuffer());
}

/** حقائق الملف كما تقرأها وحدة files، باستعلام الاختبار المحلي نفسه دون سهم استيراد نحو files. */
type FactsRow = {
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

async function testFileFacts(
  tx: unknown,
  companyId: string,
  fileId: string,
): Promise<ServiceImportFileFacts | null> {
  const rows = await (tx as Tx).execute<FactsRow>(sql`
    SELECT business_id, created_by, owner_module, content_type, size_bytes::int AS size_bytes, status,
      CASE WHEN status='READY' THEN storage_key END AS storage_key,
      purged_at IS NOT NULL AS purged, purge_started_at IS NOT NULL AS purge_started
    FROM file_objects WHERE company_id=${companyId} AND id=${fileId}`);
  return rows[0] ?? null;
}

export async function seedCatalogWorkspace(
  h: Awaited<ReturnType<typeof startHarness>>,
  ids: ReturnType<typeof systemUuidV7>,
) {
  const ownerCookie = await h.signedInOperator('catalog-import-owner@example.test');
  const company = await h.onboard(ownerCookie, 'Catalog import employer');
  const [holder] = await h.owner`SELECT id FROM "user" WHERE email='catalog-import-owner@example.test'`;
  const userId = holder?.['id'] as string;
  const business = ids.newId();
  const secondBusiness = ids.newId();
  for (const [id, name] of [
    [business, 'Catalog business'],
    [secondBusiness, 'Catalog other business'],
  ] as const)
    await h.owner`INSERT INTO businesses (company_id,id,name_en,vertical_type) VALUES (${company},${id},${name},'salon')`;
  return { company, business, secondBusiness, userId };
}

type FixtureScope = {
  h: Awaited<ReturnType<typeof startHarness>>;
  ids: ReturnType<typeof systemUuidV7>;
  company: string;
  business: string;
  userId: string;
  storage: Map<string, Uint8Array>;
};

/** رفع ملف موثّق READY داخل التخزين الذاكري مع صف file_objects مطابق. */
function uploadHelper(scope: FixtureScope) {
  return async (
    content: Uint8Array,
    options: {
      businessId?: string;
      createdBy?: string;
      contentType?: string;
      purgeStarted?: boolean;
    } = {},
  ): Promise<string> => {
    const fileId = scope.ids.newId();
    const storageKey = `verified/${scope.ids.newId()}`;
    scope.storage.set(storageKey, content);
    await scope.h.owner`INSERT INTO file_objects
      (company_id,id,business_id,owner_module,owner_entity_id,staging_key,storage_key,content_type,size_bytes,required_permission,created_by,created_at,status,purge_started_at)
      VALUES (${scope.company},${fileId},${options.businessId ?? scope.business},'catalog',${scope.business},${`staging/${fileId}`},${storageKey},
        ${options.contentType ?? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'},${content.byteLength},
        'read:files:business',${options.createdBy ?? scope.userId},now(),'READY',
        CASE WHEN ${options.purgeStarted === true} THEN now() ELSE NULL END)`;
    return fileId;
  };
}

/** مساعدات بيانات الكتالوج: تصنيف وخدمة ومعاينة مبدئية. */
function dataHelpers(scope: FixtureScope) {
  return {
    async category(nameEn: string, nameAr: string | null, businessId?: string): Promise<string> {
      const id = scope.ids.newId();
      await scope.h.owner`INSERT INTO service_categories
        (company_id,id,business_id,name_en,name_ar,visibility,owner_branch_id,created_at,updated_at)
        VALUES (${scope.company},${id},${businessId ?? scope.business},${nameEn},${nameAr},'BUSINESS',NULL,now(),now())`;
      return id;
    },
    async service(nameEn: string, businessId?: string, closedAt?: Date): Promise<string> {
      const id = scope.ids.newId();
      await scope.h.owner`INSERT INTO services
        (company_id,id,business_id,name_en,price,commission_rule_kind,counts_toward_threshold,closed_at)
        VALUES (${scope.company},${id},${businessId ?? scope.business},${nameEn},'1.000','FOLLOW_PLAN',TRUE,${closedAt ?? null})`;
      return id;
    },
    async previewRow(businessId: string, nameEn: string, status = 'ready'): Promise<string> {
      const id = scope.ids.newId();
      const rows = [
        {
          row: 2,
          name_en: nameEn,
          name_ar: null,
          price: '1.000',
          duration_minutes: null,
          category_id: null,
          category_name_en: null,
          commission_rule: { kind: 'FOLLOW_PLAN' },
          commission_value: null,
          commission_rule_defaulted: true,
          counts_toward_threshold: true,
        },
      ];
      await scope.h.owner`INSERT INTO import_previews
        (company_id,id,business_id,entity,file_id,created_by,created_at,expires_at,row_count,error_count,rows,errors,status)
        VALUES (${scope.company},${id},${businessId},'services',${scope.ids.newId()},${scope.userId},now(),
          now() + interval '24 hours',1,0,${JSON.stringify(rows)}::jsonb,'[]'::jsonb,${status})`;
      return id;
    },
  };
}

export async function serviceImportFixture() {
  const h = await startHarness();
  const ids = systemUuidV7();
  const { company, business, secondBusiness, userId } = await seedCatalogWorkspace(h, ids);
  const db = createDatabase({ url: h.urls.app, ids });
  const storage = new Map<string, Uint8Array>();
  const clock = { value: new Date('2026-11-22T10:00:00Z') };
  const scope: FixtureScope = { h, ids, company, business, userId, storage };
  const files = bindServiceImportFiles(
    {
      read: (key: string, maxBytes: number): Promise<Uint8Array> => {
        const found = storage.get(key);
        if (found === undefined) throw new Error('STORAGE_UNAVAILABLE');
        return Promise.resolve(found.subarray(0, maxBytes));
      },
    },
    testFileFacts,
  );
  const transactions = createServiceImportTransactions(db, files.fileFacts, ids);
  const helpers = dataHelpers(scope);
  return {
    h,
    db,
    company,
    business,
    secondBusiness,
    userId,
    clock,
    ids,
    template: new GetServiceImportTemplateUseCase(transactions, createServiceImportTemplateBuilder()),
    preview: new PreviewServiceImportUseCase(
      transactions,
      files.bytes as NonNullable<typeof files.bytes>,
      createServiceImportSheetReader(),
      ids,
      { now: () => clock.value },
    ),
    status: (businessId: string, previewId: string) =>
      serviceImportStatusQuery(db, company, userId, businessId, previewId),
    rows: (businessId: string, previewId: string, cursor?: string, limit?: number) =>
      serviceImportRowsPage(db, company, userId, businessId, previewId, cursor, limit ?? 20),
    upload: uploadHelper(scope),
    category: helpers.category,
    service: helpers.service,
    previewRow: helpers.previewRow,
    close: async () => {
      await db.close();
      await h.close();
    },
  };
}

export type ServiceImportFixture = Awaited<ReturnType<typeof serviceImportFixture>>;

export const previewCommand = (f: ServiceImportFixture, fileId: string, businessId?: string) => ({
  companyId: f.company,
  userId: f.userId,
  businessId: businessId ?? f.business,
  fileId,
});
