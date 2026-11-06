import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { sql } from 'drizzle-orm';
import { ExecutePackagePreview } from '../use-cases/execute-package-preview/execute-package-preview.ts';
import { packagePreviewTransactions } from '../persistence/package-preview.transactions.ts';
import { packagePreviewWorkbook } from '../persistence/package-preview-workbook.ts';
import {
  packagePreviewFixture,
  packageWorkbook,
  editPackageWorkbook,
  SYNTHETIC_PHONE,
  type PackagePreviewFixture,
} from './package-preview.fixture.ts';

let f: PackagePreviewFixture;
beforeAll(async () => {
  f = await packagePreviewFixture();
});

it('stores validation errors as ready and permits multiple issues on one source row', async () => {
  const content = await editPackageWorkbook(await packageWorkbook(1, 2, 'invalid'), (sheet) => {
    sheet.getCell('A2').value = 'invalid';
    sheet.getCell('B2').value = null;
    sheet.getCell('D2').value = 'not-money';
  });
  const { id } = await f.requested(content);
  await f.worker.execute(f.company, id);
  const [result] =
    await f.owner`SELECT status,row_count,error_count,rows,errors,source_rows,skipped_rows FROM import_previews WHERE id=${id}`;
  expect(result).toMatchObject({
    status: 'ready',
    row_count: 1,
    rows: [],
    source_rows: [2],
    skipped_rows: [],
  });
  expect(Number(result?.['error_count'])).toBeGreaterThan(1);
  expect(JSON.stringify(result)).not.toContain('not-money');
});

it.each(['unknown-customer', 'unknown-service', 'duplicate-reference'])(
  'returns safe ready errors for %s',
  async (scenario) => {
    const content = await editPackageWorkbook(
      await packageWorkbook(scenario === 'duplicate-reference' ? 2 : 1, 2, scenario),
      (sheet) => {
        if (scenario === 'unknown-customer') sheet.getCell('A2').value = '+99998765432';
        if (scenario === 'unknown-service') sheet.getCell('G2').value = 'Synthetic missing service';
        if (scenario === 'duplicate-reference')
          sheet.getCell('F3').value = sheet.getCell('F2').value;
      },
    );
    const { id } = await f.requested(content);
    await f.worker.execute(f.company, id);
    const [result] = await f.owner`SELECT status,rows,errors FROM import_previews WHERE id=${id}`;
    expect(result).toMatchObject({ status: 'ready', rows: [] });
    const expected = {
      'unknown-customer': 'IMPORT_CUSTOMER_NOT_FOUND',
      'unknown-service': 'IMPORT_SERVICE_NOT_FOUND',
      'duplicate-reference': 'IMPORT_EXTERNAL_REF_DUPLICATE',
    }[scenario];
    expect(result?.['errors']).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: expected })]),
    );
    expect(JSON.stringify(result)).not.toContain('+99998765432');
  },
);

it('detects ambiguous service names and never replaces a terminal failure from another job', async () => {
  const service = f.ids.newId();
  await f.owner`INSERT INTO services(company_id,id,business_id,name_en,price,commission_rule_kind)
    VALUES(${f.company},${service},${f.business},'Service 0','1.000','FOLLOW_PLAN')`;
  try {
    const { id } = await f.requested(await packageWorkbook(1, 2, 'ambiguous'));
    await f.worker.execute(f.company, id);
    expect(
      (await f.owner`SELECT status,errors FROM import_previews WHERE id=${id}`)[0],
    ).toMatchObject({
      status: 'ready',
      errors: expect.arrayContaining([
        expect.objectContaining({ code: 'IMPORT_SERVICE_AMBIGUOUS' }),
      ]),
    });
  } finally {
    await f.owner`DELETE FROM services WHERE id=${service}`;
  }
  const { id } = await f.requested(await packageWorkbook(1, 2, 'terminal-race'));
  const worker = new ExecutePackagePreview(
    packagePreviewTransactions(f.database),
    packagePreviewWorkbook(async (key) => {
      await f.worker.fail(f.company, id);
      return f.readBytes(key);
    }),
    f.clock,
  );
  await worker.execute(f.company, id);
  expect(
    (await f.owner`SELECT status,error_code,rows FROM import_previews WHERE id=${id}`)[0],
  ).toMatchObject({ status: 'failed', error_code: 'STORAGE_UNAVAILABLE', rows: [] });
});
afterAll(async () => {
  await f?.close();
});

it('previews all 500 rows and 20 groups at 365 sessions without storing phones or financial effects', async () => {
  const { id } = await f.requested(await packageWorkbook(500, 20, 'maximum'));
  await f.worker.execute(f.company, id);
  const [result] =
    await f.owner`SELECT status,row_count,error_count,skipped_count,rows,errors,source_rows,skipped_rows FROM import_previews WHERE id=${id}`;
  expect(result).toMatchObject({
    status: 'ready',
    row_count: 500,
    error_count: 0,
    skipped_count: 0,
    errors: [],
    source_rows: Array.from({ length: 500 }, (_, index) => index + 2),
    skipped_rows: [],
  });
  const rows = result?.['rows'] as {
    price_paid: string;
    expires_on: string;
    phone_last3: string;
    components: { component_value: string; base_unit_value: string; last_unit_value: string }[];
  }[];
  expect(rows).toHaveLength(500);
  for (const row of rows) {
    expect(row.price_paid).toBe('10.001');
    expect(row.expires_on).toBe('2020-01-01');
    expect(row.phone_last3).toBe('678');
    expect(row.components).toHaveLength(20);
    expect(
      row.components
        .slice(0, 19)
        .every(
          (c) =>
            c.component_value === '0.365' &&
            c.base_unit_value === '0.001' &&
            c.last_unit_value === '0.001',
        ),
    ).toBe(true);
    expect(row.components[19]).toMatchObject({
      component_value: '3.066',
      base_unit_value: '0.001',
      last_unit_value: '2.702',
    });
  }
  expect(JSON.stringify(result)).not.toContain(SYNTHETIC_PHONE);
  expect(await f.owner`SELECT id FROM package_entitlements WHERE company_id=${f.company}`).toEqual(
    [],
  );
  expect(await f.owner`SELECT id FROM outbox WHERE company_id=${f.company}`).toEqual([]);
}, 30000);

it('ignores repeated and foreign-tenant jobs and preserves the first terminal result', async () => {
  const { id } = await f.requested(await packageWorkbook(1, 2, 'repeat'));
  const read = vi.fn(f.readBytes);
  const worker = new ExecutePackagePreview(
    packagePreviewTransactions(f.database),
    packagePreviewWorkbook(read),
    f.clock,
  );
  await worker.execute(f.otherCompany, id);
  expect(read).not.toHaveBeenCalled();
  await Promise.all([worker.execute(f.company, id), worker.execute(f.company, id)]);
  const [original] = await f.owner`SELECT status,rows FROM import_previews WHERE id=${id}`;
  expect(original?.['status']).toBe('ready');
  read.mockClear();
  await worker.execute(f.company, id);
  await worker.fail(f.company, id);
  expect(read).not.toHaveBeenCalled();
  expect((await f.owner`SELECT status,rows FROM import_previews WHERE id=${id}`)[0]).toEqual(
    original,
  );
});

it('marks permanent workbook errors failed and retries transient provider failures without leaking their messages', async () => {
  const broken = await f.requested(new Uint8Array([1, 2, 3]));
  await f.worker.execute(f.company, broken.id);
  expect(
    (await f.owner`SELECT status,error_code FROM import_previews WHERE id=${broken.id}`)[0],
  ).toMatchObject({ status: 'failed', error_code: 'IMPORT_FILE_CONTENT_INVALID' });
  const transient = await f.requested(await packageWorkbook(1, 2, 'transient'));
  const worker = new ExecutePackagePreview(
    packagePreviewTransactions(f.database),
    packagePreviewWorkbook(async () => {
      throw new Error(`Synthetic provider ${SYNTHETIC_PHONE}`);
    }),
    f.clock,
  );
  await expect(worker.execute(f.company, transient.id)).rejects.toThrow('PACKAGE_PREVIEW_RETRY');
  expect(
    (await f.owner`SELECT status FROM import_previews WHERE id=${transient.id}`)[0]?.['status'],
  ).toBe('pending');
  await worker.fail(f.company, transient.id);
  expect(
    (await f.owner`SELECT status,error_code FROM import_previews WHERE id=${transient.id}`)[0],
  ).toMatchObject({ status: 'failed', error_code: 'STORAGE_UNAVAILABLE' });
});

it('rolls back a failed persistence attempt and refuses a changed file after reading bytes', async () => {
  const first = await f.requested(await packageWorkbook(1, 2, 'rollback'));
  const transactions = packagePreviewTransactions(f.database);
  const worker = new ExecutePackagePreview(
    {
      ...transactions,
      finish: (company, id, work) =>
        transactions.finish(company, id, (scope) =>
          work({
            ...scope,
            ready: async (...args) => {
              await scope.ready(...args);
              throw new Error('Synthetic crash');
            },
          }),
        ),
    },
    packagePreviewWorkbook(f.readBytes),
    f.clock,
  );
  await expect(worker.execute(f.company, first.id)).rejects.toThrow('PACKAGE_PREVIEW_RETRY');
  expect(
    (await f.owner`SELECT status,row_count,rows FROM import_previews WHERE id=${first.id}`)[0],
  ).toMatchObject({ status: 'pending', row_count: 0, rows: [] });
  const changed = await f.requested(await packageWorkbook(1, 2, 'changed'));
  const changedWorker = new ExecutePackagePreview(
    transactions,
    packagePreviewWorkbook(async (key) => {
      const bytes = await f.readBytes(key);
      await f.owner`UPDATE file_objects SET purge_started_at=now() WHERE id=${changed.file}`;
      return bytes;
    }),
    f.clock,
  );
  await changedWorker.execute(f.company, changed.id);
  expect(
    (await f.owner`SELECT status,error_code FROM import_previews WHERE id=${changed.id}`)[0],
  ).toMatchObject({ status: 'failed', error_code: 'IMPORT_FILE_NOT_FOUND' });
});

it('rejects inconsistent ready metadata but permits multiple issues on one bad input row', async () => {
  const { id } = await f.requested(await packageWorkbook(1, 2, 'metadata'));
  for (const change of [
    sql`rows='{}'::jsonb,row_count=1`,
    sql`rows='[{},{}]'::jsonb,row_count=1`,
    sql`errors='[{"row":2}]'::jsonb,error_count=0,row_count=1`,
    sql`rows='[{"row":2}]'::jsonb,errors='[{"row":"02"}]'::jsonb,row_count=2,error_count=1`,
    sql`rows='[{"row":2},{"row":2}]'::jsonb,row_count=2`,
    sql`rows='[{"row":2}]'::jsonb,errors='[{"row":2}]'::jsonb,row_count=2,error_count=1`,
  ]) {
    await expect(
      f.db.withTenant(f.company, (tx) =>
        tx.execute(sql`UPDATE import_previews SET status='ready',${change} WHERE id=${id}`),
      ),
    ).rejects.toMatchObject({
      cause: { code: '23514', message: 'IMPORT_PREVIEW_READY_RESULTS_INVALID' },
    });
  }
  await f.db.withTenant(f.company, (tx) =>
    tx.execute(sql`UPDATE import_previews SET status='ready',row_count=1,error_count=2,
    source_rows='[2]'::jsonb,skipped_rows='[]'::jsonb,
    errors='[{"row":2,"column":"name_en","code":"IMPORT_NAME_INVALID"},{"row":2,"column":"price_paid","code":"IMPORT_PRICE_INVALID"}]'::jsonb WHERE id=${id}`),
  );
  expect(
    (await f.owner`SELECT status,error_count FROM import_previews WHERE id=${id}`)[0],
  ).toMatchObject({ status: 'ready', error_count: 2 });
});

it('holds the source file against concurrent purge until the ready result commits', async () => {
  const { id, file } = await f.requested(await packageWorkbook(1, 2, 'file-lock'));
  const transactions = packagePreviewTransactions(f.database);
  const worker = new ExecutePackagePreview(
    {
      ...transactions,
      finish: (company, preview, work) =>
        transactions.finish(company, preview, async (scope) => {
          await expect(
            f.owner.begin(async (tx) => {
              await tx`SET LOCAL lock_timeout='100ms'`;
              await tx`UPDATE file_objects SET purge_started_at=now() WHERE id=${file}`;
            }),
          ).rejects.toMatchObject({ code: '55P03' });
          return work(scope);
        }),
    },
    packagePreviewWorkbook(f.readBytes),
    f.clock,
  );
  await worker.execute(f.company, id);
  expect((await f.owner`SELECT status FROM import_previews WHERE id=${id}`)[0]?.['status']).toBe(
    'ready',
  );
  await f.owner`UPDATE file_objects SET purge_started_at=now() WHERE id=${file}`;
  expect(
    (await f.owner`SELECT purge_started_at FROM file_objects WHERE id=${file}`)[0]?.[
      'purge_started_at'
    ],
  ).not.toBeNull();
});
