import { expect, it } from 'vitest';

import type { TenantWrappers } from '@pospay/db';

import {
  previewCommand,
  serviceImportFixture,
  serviceWorkbook,
  type ImportRow,
  type ServiceImportFixture,
} from './service-import.fixture.ts';

// فشل المطابقة والحفظ بعد قراءة البايتات لا يمسح تدقيق الوصول للملف الخاص: التدقيق في معاملته
// المستقلة المثبتة قبل أي عمل آخر (CLAUDE.md §8، P2 مراجعة 1186).
it('keeps the private-file access audit even when match-and-save fails', async () => {
  const f = await serviceImportFixture();
  try {
    const fileId = await f.upload(
      await serviceWorkbook([['Audit Survivor', null, 1, null, null, null, null, null]]),
    );
    let calls = 0;
    const failing = {
      withTenant: (
        companyId: string,
        work: (tx: unknown) => Promise<unknown>,
        options?: { readonly userId?: string },
      ): Promise<unknown> => {
        calls += 1;
        if (calls >= 3) return Promise.reject(new Error('MATCH_SAVE_DOWN'));
        return f.db.withTenant(companyId, work as never, options as never);
      },
    } as unknown as TenantWrappers;
    await expect(f.previewWith(failing).execute(previewCommand(f, fileId))).rejects.toThrow(
      'SERVICE_IMPORT_PERSISTENCE_FAILED',
    );
    const audits =
      await f.h.owner`SELECT action FROM audit_log WHERE company_id=${f.company} AND entity='file' AND entity_id=${fileId} AND action='access'`;
    expect(audits).toHaveLength(1);
  } finally {
    await f.close();
  }
});

// معاينة واحدة على معاملة مستأجر واحدة: صفوف مطبّعة وأخطاء مسمّاة، بلا كتابة أي خدمة أو تدقيق.

it.each([
  ['matched open category keeps the stored id and name', 'Hair Cut', 'HAIR   cut', true],
  ['unknown category refuses the cell', 'Hair Cut', 'Not a category', false],
] as const)('%s', async (_name, service, category, matched) => {
  const f = await serviceImportFixture();
  try {
    const categoryId = await f.category('Hair Cut', 'قص الشعر');
    const servicesBefore = await countServices(f);
    const fileId = await f.upload(
      await serviceWorkbook([[service, 'قص', 12.5, 30, category, 'PCT', 12.5, 'yes']]),
    );
    const preview = await f.preview.execute(previewCommand(f, fileId));
    const [stored] = await f.h
      .owner`SELECT rows,errors FROM import_previews WHERE company_id=${f.company} AND id=${preview.preview_id}`;
    if (matched) {
      expect(stored?.['errors']).toEqual([]);
      expect(stored?.['rows']).toHaveLength(1);
      expect(stored?.['rows'][0]).toMatchObject({
        name_en: 'Hair Cut',
        price: '12.500',
        duration_minutes: 30,
        category_id: categoryId,
        category_name_en: 'Hair Cut',
        commission_rule: { kind: 'PCT', value: 1250 },
        commission_value: 1250,
        commission_rule_defaulted: false,
        counts_toward_threshold: true,
      });
    } else {
      expect(stored?.['rows']).toEqual([]);
      expect(stored?.['errors']).toEqual([
        { row: 2, column: 'category', code: 'IMPORT_CATEGORY_NOT_FOUND' },
      ]);
    }
    expect(await countServices(f)).toBe(servicesBefore);
    expect(await countServiceAudits(f)).toBe(0);
  } finally {
    await f.close();
  }
});

it('reports every bad cell of a row by its original row and column and drops the row', async () => {
  const f = await serviceImportFixture();
  try {
    const fileId = await f.upload(
      await serviceWorkbook([['  ', 'Name', 'bad', 999, 'Ghost', 'MAYBE', 5, 'maybe']]),
    );
    const preview = await f.preview.execute(previewCommand(f, fileId));
    expect(preview.rows).toEqual([]);
    expect(preview.next_cursor).toBeNull();
    expect(preview.error_count).toBe(6);
    const cells = preview.errors.map((error) => [error.row, error.column, error.code]);
    expect(cells).toContainEqual([2, 'name_en', 'IMPORT_REQUIRED_CELL']);
    expect(cells).toContainEqual([2, 'price', 'IMPORT_PRICE_INVALID']);
    expect(cells).toContainEqual([2, 'duration_minutes', 'IMPORT_DURATION_INVALID']);
    expect(cells).toContainEqual([2, 'category', 'IMPORT_CATEGORY_NOT_FOUND']);
    expect(cells).toContainEqual([2, 'commission_rule', 'IMPORT_COMMISSION_RULE_INVALID']);
    expect(cells).toContainEqual([2, 'counts_toward_threshold', 'IMPORT_BOOLEAN_INVALID']);
  } finally {
    await f.close();
  }
});

it('marks every group member of an in-file duplicate and every stored-name conflict', async () => {
  const f = await serviceImportFixture();
  try {
    await f.service('Existing Spa');
    await f.service('Closed Salon', undefined, new Date('2026-11-01T00:00:00Z'));
    const servicesBefore = await countServices(f);
    const rows: ImportRow[] = [
      ['Existing Spa', null, 5, null, null, null, null, null],
      ['existing   spa', null, 6, null, null, null, null, null],
      ['Closed Salon', null, 7, null, null, null, null, null],
      ['Fresh Name', null, 'x', null, null, null, null, null],
    ];
    const fileId = await f.upload(await serviceWorkbook(rows));
    const preview = await f.preview.execute(previewCommand(f, fileId));
    const byRow = new Map(preview.errors.map((error) => [error.row, error.code]));
    expect(byRow.get(2)).toBe('IMPORT_DUPLICATE_IN_FILE');
    expect(byRow.get(3)).toBe('IMPORT_DUPLICATE_IN_FILE');
    expect(byRow.get(4)).toBe('IMPORT_SERVICE_EXISTS');
    expect(byRow.get(5)).toBe('IMPORT_PRICE_INVALID');
    expect(preview.rows.map((row) => row.name_en)).toEqual([]);
    expect(await countServices(f)).toBe(servicesBefore);
    expect(await countServiceAudits(f)).toBe(0);
  } finally {
    await f.close();
  }
});

it('conflicts an import name against a stored service carrying internal whitespace runs', async () => {
  const f = await serviceImportFixture();
  try {
    // الإنهاء اليدوي يخزّن الاسم كما أدخل: مسافة داخلية مزدوجة تبقى في القاعدة (P1 مراجعة 32b-2).
    await f.h.owner`INSERT INTO services
      (company_id,id,business_id,name_en,price,commission_rule_kind,counts_toward_threshold)
      VALUES (${f.company},${f.ids.newId()},${f.business},'Hair  Cut','1.000','FOLLOW_PLAN',TRUE)`;
    const fileId = await f.upload(
      await serviceWorkbook([['Hair Cut', null, 5, null, null, null, null, null]]),
    );
    const preview = await f.preview.execute(previewCommand(f, fileId));
    expect(preview.errors.map((error) => error.code)).toContain('IMPORT_SERVICE_EXISTS');
    expect(preview.rows).toEqual([]);
  } finally {
    await f.close();
  }
});

it('keeps a valid name key on an otherwise invalid row and conflicts it with stored services', async () => {
  const f = await serviceImportFixture();
  try {
    await f.service('Valid Name');
    const fileId = await f.upload(
      await serviceWorkbook([['Valid Name', null, 'bad-price', null, null, null, null, null]]),
    );
    const preview = await f.preview.execute(previewCommand(f, fileId));
    expect(preview.errors.map((error) => error.code)).toContain('IMPORT_SERVICE_EXISTS');
    expect(preview.errors.map((error) => error.code)).toContain('IMPORT_PRICE_INVALID');
  } finally {
    await f.close();
  }
});

it('never conflicts names from another business of the same company', async () => {
  const f = await serviceImportFixture();
  try {
    await f.service('Same Name', f.secondBusiness);
    const fileId = await f.upload(
      await serviceWorkbook([['Same Name', null, 3, null, null, null, null, null]]),
    );
    const preview = await f.preview.execute(previewCommand(f, fileId));
    expect(preview.error_count).toBe(0);
    expect(preview.rows).toHaveLength(1);
  } finally {
    await f.close();
  }
});

it('reads a percent-formatted cell as basis points and a plain cell as percent points', async () => {
  const f = await serviceImportFixture();
  try {
    const workbookRows: ImportRow[] = [
      ['Percent Cell', null, 1, null, null, 'PCT', '12.5', null],
    ];
    const fileId = await f.upload(await serviceWorkbook(workbookRows));
    const preview = await f.preview.execute(previewCommand(f, fileId));
    expect(preview.rows[0]?.commission_rule).toEqual({ kind: 'PCT', value: 1250 });
  } finally {
    await f.close();
  }
});

it('pages the clean rows by original row numbers and closes with a null cursor', async () => {
  const f = await serviceImportFixture();
  try {
    // 130 صفاً نظيفاً: المعاينة تعرض أول 100 والبقية عبر مسار الصفحات (عقد ServiceImportPreview).
    const rows: ImportRow[] = Array.from({ length: 130 }, (_, index) => [
      `Service ${String(index + 1).padStart(3, '0')}`,
      null,
      index + 1,
      null,
      null,
      null,
      null,
      null,
    ]);
    const fileId = await f.upload(await serviceWorkbook(rows));
    const preview = await f.preview.execute(previewCommand(f, fileId));
    expect(preview.row_count).toBe(130);
    expect(preview.errors).toEqual([]);
    const [stored] = await f.h
      .owner`SELECT jsonb_array_length(rows) AS len, rows->122 AS r122 FROM import_previews WHERE company_id=${f.company} AND id=${preview.preview_id}`;
    expect(stored?.['len']).toBe(130);
    expect(stored?.['r122']).toMatchObject({ row: 124 });
    expect(stored?.['r122']).toMatchObject({ name_en: 'Service 123' });
    expect(preview.rows).toHaveLength(100);
    expect(preview.rows[0]?.name_en).toBe('Service 001');
    expect(preview.next_cursor).toBe('101');
    const second = await f.rows(f.business, preview.preview_id, preview.next_cursor ?? undefined);
    expect(second.items).toHaveLength(20);
    expect(second.items[0]?.name_en).toBe('Service 101');
    const last = await f.rows(f.business, preview.preview_id, second.next_cursor ?? undefined, 50);
    expect(last.items).toHaveLength(10);
    expect(last.items[0]?.name_en).toBe('Service 121');
    expect(last.next_cursor).toBeNull();
  } finally {
    await f.close();
  }
});

it('answers unknown, foreign-business and foreign-entity previews with the same refusal', async () => {
  const f = await serviceImportFixture();
  try {
    const fileId = await f.upload(await serviceWorkbook([['A', null, 1, null, null, null, null, null]]));
    const preview = await f.preview.execute(previewCommand(f, fileId));
    await expect(f.status(f.business, preview.preview_id)).resolves.toMatchObject({
      preview_id: preview.preview_id,
      status: 'ready',
      created_count: 0,
      error_code: null,
    });
    await expect(f.status(f.secondBusiness, preview.preview_id)).rejects.toMatchObject({
      code: 'IMPORT_PREVIEW_NOT_FOUND',
    });
    await expect(f.rows(f.secondBusiness, preview.preview_id)).rejects.toMatchObject({
      code: 'IMPORT_PREVIEW_NOT_FOUND',
    });
    const fileId2 = await f.upload(await serviceWorkbook([['B', null, 1, null, null, null, null, null]]), {
      businessId: f.secondBusiness,
    });
    const other = await f.preview.execute(previewCommand(f, fileId2, f.secondBusiness));
    await expect(f.status(f.secondBusiness, other.preview_id)).resolves.toMatchObject({
      preview_id: other.preview_id,
    });
  } finally {
    await f.close();
  }
});

  it('refuses a file whose purge has started before reading any bytes', async () => {
    const f = await serviceImportFixture();
    try {
      const fileId = await f.upload(await serviceWorkbook([['A', null, 1, null, null, null, null, null]]), {
        purgeStarted: true,
      });
      await expect(f.preview.execute(previewCommand(f, fileId))).rejects.toMatchObject({
        code: 'IMPORT_FILE_NOT_FOUND',
      });
    } finally {
      await f.close();
    }
  });

it('reads a real percentage-formatted numeric cell as basis points, not percentage points', async () => {
  const f = await serviceImportFixture();
  try {
    const fileId = await f.upload(
      await serviceWorkbook([['Percent Cell', null, 1, null, null, 'PCT', 0.125, null]], {
        numericFormats: [{ row: 0, col: 6, numFmt: '0.00%' }],
      }),
    );
    const preview = await f.preview.execute(previewCommand(f, fileId));
    expect(preview.rows[0]?.commission_rule).toEqual({ kind: 'PCT', value: 1250 });
  } finally {
    await f.close();
  }
});

it('refuses a file uploaded for another module even when creator and type match', async () => {
  const f = await serviceImportFixture();
  try {
    const fileId = await f.upload(await serviceWorkbook([['A', null, 1, null, null, null, null, null]]), {
      contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    void fileId;
    const foreign = await f.upload(
      await serviceWorkbook([['B', null, 1, null, null, null, null, null]]),
      { contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' },
    );
    void foreign;
    const staffFileId = await f.upload(
      await serviceWorkbook([['C', null, 1, null, null, null, null, null]]),
      { contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' },
    );
    // أعِد ربط الملف الأخير لوحدة staff عبر تحديث مباشر ثم توقع الرفض.
    await f.h.owner`UPDATE file_objects SET owner_module='staff'
      WHERE company_id=${f.company} AND id=${staffFileId}`;
    await expect(f.preview.execute(previewCommand(f, staffFileId))).rejects.toMatchObject({
      code: 'IMPORT_FILE_NOT_FOUND',
    });
  } finally {
    await f.close();
  }
});

it('refuses a workbook with wrong headers, extra sheets overflow and oversized bytes', async () => {
  const f = await serviceImportFixture();
  try {
    const badHeaders = await f.upload(
      await serviceWorkbook([['A', null, 1, null, null, null, null, null]], {
        headers: ['name_en', 'name_ar', 'price', 'extra', 'b', 'c', 'd', 'e'],
      }),
    );
    await expect(f.preview.execute(previewCommand(f, badHeaders))).rejects.toMatchObject({
      code: 'IMPORT_HEADER_INVALID',
    });
    const big = new Uint8Array(2 * 1024 * 1024 + 1);
    const bigId = await f.upload(big);
    await expect(f.preview.execute(previewCommand(f, bigId))).rejects.toMatchObject({
      code: 'IMPORT_FILE_SIZE_INVALID',
    });
    const foreign = await f.upload(await serviceWorkbook([['A', null, 1, null, null, null, null, null]]), {
      businessId: f.secondBusiness,
      createdBy: f.userId,
    });
    await expect(f.preview.execute(previewCommand(f, foreign))).rejects.toMatchObject({
      code: 'IMPORT_FILE_NOT_FOUND',
    });
  } finally {
    await f.close();
  }
});

async function countServices(f: ServiceImportFixture): Promise<number> {
  const [row] = await f.h.owner`SELECT count(*) AS count FROM services WHERE company_id=${f.company}`;
  return Number(row?.['count']);
}

async function countServiceAudits(f: ServiceImportFixture): Promise<number> {
  const [row] =
    await f.h.owner`SELECT count(*) AS count FROM audit_log WHERE company_id=${f.company} AND entity='service'`;
  return Number(row?.['count']);
}
