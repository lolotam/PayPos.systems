import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import { packageImportTemplate } from '@pospay/contracts';
import { readSheet, readWorkbookMatrix } from '@pospay/import-workbooks';
import {
  PACKAGE_IMPORT_TEMPLATE_BOUNDS,
  PACKAGE_IMPORT_TEMPLATE_HEADERS,
  PACKAGE_IMPORT_TEMPLATE_MAX_SERVICES,
} from '../domain/package-import-template.ts';
import { createPackageImportTemplateBuilder } from '../persistence/package-import-template.ts';
import {
  packagePreviewRequestFixture,
  type PackagePreviewRequestFixture,
} from './package-preview-request.fixture.ts';

let f: PackagePreviewRequestFixture;
beforeAll(async () => {
  f = await packagePreviewRequestFixture();
});
afterAll(async () => {
  await f?.close();
});
const templateUrl = (businessId = f.businessId) =>
  `/v1/businesses/${businessId}/packages/import/template`;
const get = (businessId?: string) =>
  f.h.app.inject({ method: 'GET', url: templateUrl(businessId), headers: f.headers });

async function addService(businessId: string, name: string, closed = false) {
  await f.h
    .owner`INSERT INTO services(company_id,id,business_id,name_en,name_ar,price,commission_rule_kind,closed_at)
    VALUES (${f.companyId},${f.ids.newId()},${businessId},${name},${`${name} ar`},'5.000','FOLLOW_PLAN',
      ${closed ? new Date() : null})`;
}

async function workbookOf(content: string) {
  const bytes = new Uint8Array(Buffer.from(content, 'base64'));
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(Buffer.from(bytes) as unknown as Parameters<typeof book.xlsx.load>[0]);
  return { bytes, book };
}

describe('GET template', () => {
  it('downloads a workbook the preview reader accepts, listing only open services', async () => {
    await addService(f.businessId, 'Open synthetic service');
    await addService(f.businessId, 'Closed synthetic service', true);
    const response = await get();
    expect(response.statusCode).toBe(200);
    const template = packageImportTemplate.parse(response.json());
    expect(template.file_name).toBe('packages-import-template.xlsx');
    const { bytes, book } = await workbookOf(template.content_base64);
    const matrix = await readWorkbookMatrix(bytes, PACKAGE_IMPORT_TEMPLATE_BOUNDS);
    expect(matrix[0]).toEqual([...PACKAGE_IMPORT_TEMPLATE_HEADERS]);
    expect(book.worksheets.map((sheet) => sheet.name)).toEqual(['packages', 'services']);
    const names = (book.getWorksheet('services')?.getColumn(1).values ?? []).map(String);
    expect(names).toContain('Open synthetic service');
    expect(names).not.toContain('Closed synthetic service');
    const note = book.getWorksheet('packages')?.getCell('A1').note;
    expect(JSON.stringify(note)).toMatch(/[؀-ۿ]/);
  });

  it('round-trips once a data row is filled, exactly as the worker preview reads it', async () => {
    const { content_base64 } = packageImportTemplate.parse((await get()).json());
    const { book } = await workbookOf(content_base64);
    const sheet = book.getWorksheet('packages');
    sheet?.addRow([
      '+99912345678',
      'Synthetic package',
      null,
      '10.000',
      '2030-01-01',
      'ref-1',
      'Open synthetic service',
      5,
      5,
    ]);
    const filled = new Uint8Array(await book.xlsx.writeBuffer());
    const matrix = await readWorkbookMatrix(filled, PACKAGE_IMPORT_TEMPLATE_BOUNDS);
    const parsed = readSheet(matrix, PACKAGE_IMPORT_TEMPLATE_HEADERS, 500);
    expect(typeof parsed).not.toBe('string');
    if (typeof parsed !== 'string') expect(parsed.rows).toHaveLength(1);
  });
});

describe('GET template refusals', () => {
  it('refuses a caller without the permission or for an unknown business', async () => {
    const otherBusiness = await get(f.otherBusinessId);
    const unknown = await get(f.ids.newId());
    const anonymous = await f.h.app.inject({ method: 'GET', url: templateUrl() });
    expect([otherBusiness.statusCode, otherBusiness.json()]).toMatchObject([
      403,
      { code: 'FORBIDDEN' },
    ]);
    expect([unknown.statusCode, unknown.json()]).toMatchObject([403, { code: 'FORBIDDEN' }]);
    expect([anonymous.statusCode, anonymous.json()]).toMatchObject([
      401,
      { code: 'UNAUTHENTICATED' },
    ]);
  });

  it('refuses with FEATURE_DISABLED when orders is off', async () => {
    await f.h
      .owner`INSERT INTO company_feature_overrides(company_id,flag,enabled,reason,set_by) VALUES (${f.companyId},'orders',false,'Synthetic test',${f.userId})`;
    try {
      const response = await get();
      expect(response.statusCode).toBe(403);
      expect(response.json()).toMatchObject({ code: 'FEATURE_DISABLED' });
    } finally {
      await f.h
        .owner`DELETE FROM company_feature_overrides WHERE company_id=${f.companyId} AND flag='orders'`;
    }
  });
});

describe('template capacity', () => {
  const services = (count: number) =>
    Array.from({ length: count }, (_, index) => ({ name_en: `Service ${index}`, name_ar: null }));

  it('builds and re-reads the exact maximum number of services without truncation', async () => {
    const content = await createPackageImportTemplateBuilder().build(
      services(PACKAGE_IMPORT_TEMPLATE_MAX_SERVICES),
    );
    const { book } = await workbookOf(content);
    expect(book.getWorksheet('services')?.rowCount).toBe(PACKAGE_IMPORT_TEMPLATE_MAX_SERVICES + 1);
  });

  it('refuses one service more with IMPORT_TEMPLATE_EXCEEDS_LIMITS instead of an unimportable file', async () => {
    await expect(
      createPackageImportTemplateBuilder().build(
        services(PACKAGE_IMPORT_TEMPLATE_MAX_SERVICES + 1),
      ),
    ).rejects.toMatchObject({ code: 'IMPORT_TEMPLATE_EXCEEDS_LIMITS' });
  });

  it('answers 422 over HTTP for a business with more open services than the template can hold', async () => {
    const businessId = f.ids.newId();
    await f.h.owner`INSERT INTO businesses(company_id,id,name_en,vertical_type)
      VALUES (${f.companyId},${businessId},'Synthetic large business','salon')`;
    await f.h.owner`INSERT INTO permission_overrides
      (company_id,id,membership_id,permission_code,effect,scope_type,scope_id,reason,granted_by)
      VALUES (${f.companyId},${f.ids.newId()},${f.membershipId},'import:packages:business','ALLOW','BUSINESS',${businessId},'Synthetic test grant',${f.userId})`;
    await f.h
      .owner`INSERT INTO services(company_id,id,business_id,name_en,price,commission_rule_kind)
      SELECT ${f.companyId},gen_random_uuid(),${businessId},'Bulk service '||n,'1.000','FOLLOW_PLAN'
      FROM generate_series(1,${PACKAGE_IMPORT_TEMPLATE_MAX_SERVICES + 1}) AS n`;
    const response = await get(businessId);
    expect(response.statusCode).toBe(422);
    expect(response.json()).toMatchObject({ code: 'IMPORT_TEMPLATE_EXCEEDS_LIMITS' });
  });
});
