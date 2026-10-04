import { createDatabase, type TenantWrappers } from '@pospay/db';
import { systemUuidV7 } from '@pospay/ids';
import ExcelJS from 'exceljs';
import { createHash } from 'node:crypto';

import { startHarness } from '../../../../test/harness.ts';
import { EMPLOYEE_IMPORT_HEADERS } from '../domain/employee-import.ts';
import { createEmployeeImportTransactions } from '../persistence/drizzle-employee-import.ts';
import {
  createImportSheetReader,
  createObjectBytesReader,
} from '../persistence/import-adapters.ts';
import { PreviewEmployeeImportUseCase } from '../use-cases/preview-employee-import/preview-employee-import.usecase.ts';
import { CommitEmployeeImportUseCase } from '../use-cases/commit-employee-import/commit-employee-import.usecase.ts';
import { GetEmployeeImportTemplateUseCase } from '../use-cases/get-employee-import-template/get-employee-import-template.usecase.ts';
import { buildEmployeeImportTemplate } from '../persistence/employee-import-template.ts';

export type ImportRow = readonly (string | number | null)[];

/** مصنف اختباري بعناوين القالب وصفوف يحددها الاختبار. */
export async function employeeWorkbook(rows: readonly ImportRow[]): Promise<Uint8Array> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('employees');
  EMPLOYEE_IMPORT_HEADERS.forEach((header, index) => {
    sheet.getCell(1, index + 1).value = header;
  });
  rows.forEach((row, rowIndex) =>
    row.forEach((value, columnIndex) => {
      if (value !== null) sheet.getCell(rowIndex + 2, columnIndex + 1).value = value;
    }),
  );
  return new Uint8Array(await workbook.xlsx.writeBuffer());
}

export async function seedImportWorkspace(
  h: Awaited<ReturnType<typeof startHarness>>,
  ids: ReturnType<typeof systemUuidV7>,
) {
  const ownerCookie = await h.signedInOperator('import-owner@example.test');
  await h.signedInOperator('import-manager@example.test');
  const company = await h.onboard(ownerCookie, 'Synthetic import employer');
  const [holder] = await h.owner`SELECT id FROM "user" WHERE email='import-manager@example.test'`;
  const userId = holder?.['id'] as string;
  const memberId = ids.newId();
  await h.owner`INSERT INTO roles(id,company_id,code,name_en)
    VALUES (${ids.newId()},${company},'synthetic_import_manager','Synthetic import manager')`;
  const [role] =
    await h.owner`SELECT id FROM roles WHERE company_id=${company} AND code='synthetic_import_manager'`;
  await h.owner`INSERT INTO memberships(company_id,id,user_id,role_id,role_owner_key,scope_type,scope_id)
    VALUES (${company},${memberId},${userId},${role?.['id'] as string},${company},'COMPANY',${company})`;
  const business = ids.newId();
  const secondBusiness = ids.newId();
  for (const [id, name] of [
    [business, 'Synthetic business'],
    [secondBusiness, 'Synthetic other business'],
  ] as const)
    await h.owner`INSERT INTO businesses (company_id,id,name_en,vertical_type) VALUES (${company},${id},${name},'salon')`;
  const branch = ids.newId();
  await h.owner`INSERT INTO branches (company_id,id,business_id,name_en) VALUES (${company},${branch},${business},'Main')`;
  await h.owner`INSERT INTO permission_overrides
    (company_id,id,membership_id,permission_code,effect,scope_type,scope_id,reason,granted_by)
    VALUES (${company},${ids.newId()},${memberId},'manage:employees:business','ALLOW','BUSINESS',${business},'Synthetic import grant',${userId})`;
  return { company, business, secondBusiness, branch, userId, memberId };
}

export async function employeeImportFixture() {
  const h = await startHarness();
  const ids = systemUuidV7();
  const { company, business, secondBusiness, branch, userId, memberId } = await seedImportWorkspace(
    h,
    ids,
  );

  const db: TenantWrappers = createDatabase({ url: h.urls.app, ids });
  const storage = new Map<string, Uint8Array>();
  const clock = { value: new Date('2026-10-04T10:00:00Z') };
  const clockPort = { now: () => clock.value };
  const bytes = {
    read: (key: string, maxBytes: number): Promise<Uint8Array> => {
      const found = storage.get(key);
      if (found === undefined) throw new Error('STORAGE_UNAVAILABLE');
      return Promise.resolve(found.subarray(0, maxBytes));
    },
  };
  const transactions = createEmployeeImportTransactions(db, ids);
  return {
    h,
    db,
    company,
    business,
    secondBusiness,
    branch,
    userId,
    memberId,
    clock,
    storage,
    template: new GetEmployeeImportTemplateUseCase(transactions, {
      build: async (branches) =>
        Buffer.from(await buildEmployeeImportTemplate(branches)).toString('base64'),
    }),
    preview: new PreviewEmployeeImportUseCase(
      transactions,
      createObjectBytesReader(bytes),
      createImportSheetReader(),
      ids,
      clockPort,
    ),
    commit: new CommitEmployeeImportUseCase(transactions, ids, clockPort),
    async upload(
      content: Uint8Array,
      options: { businessId?: string; createdBy?: string } = {},
    ): Promise<string> {
      const fileId = ids.newId();
      const storageKey = `verified/${ids.newId()}`;
      storage.set(storageKey, content);
      await h.owner`INSERT INTO file_objects
        (company_id,id,business_id,owner_module,owner_entity_id,staging_key,storage_key,content_type,size_bytes,required_permission,created_by,created_at,status)
        VALUES (${company},${fileId},${options.businessId ?? business},'staff',${business},${`staging/${fileId}`},${storageKey},
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',${content.byteLength},
          'read:files:business',${options.createdBy ?? userId},now(),'READY')`;
      return fileId;
    },
  };
}

export type EmployeeImportFixture = Awaited<ReturnType<typeof employeeImportFixture>>;

export const previewCommand = (f: EmployeeImportFixture, fileId: string) => ({
  companyId: f.company,
  userId: f.userId,
  businessId: f.business,
  fileId,
});

export const commitCommand = (f: EmployeeImportFixture, previewId: string, key: string) => ({
  companyId: f.company,
  userId: f.userId,
  businessId: f.business,
  previewId,
  key,
  // runIdempotent يتطلب بصمة sha256 سداسية عشرية؛ في الإنتاج يحسبها requestFingerprint.
  fingerprint: createHash('sha256').update(previewId).digest('hex'),
});
