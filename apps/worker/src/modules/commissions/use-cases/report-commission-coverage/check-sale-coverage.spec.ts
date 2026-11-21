import { describe, expect, it, vi } from 'vitest';

import type {
  CoverageProjectionReader,
  CoverageTenantRunner,
  CoverageTx,
  PackageSaleCoverageReader,
  SaleCoverageRow,
} from '../../ports/commission-coverage.port.ts';
import { REPORT_LIST_LIMIT } from './check-retained-events.ts';
import { checkSaleCoverage } from './check-sale-coverage.ts';

const COMPANY = '01920000-0000-7000-8000-0000000000a0';
const saleId = (n: number) => `01980000-0000-7000-8000-${String(n).padStart(12, '0')}`;
const DUMMY_TX = {} as unknown as CoverageTx;

function sourceReader(rows: readonly SaleCoverageRow[], pageSize = 2) {
  const sorted = [...rows].sort((left, right) => (left.saleId < right.saleId ? -1 : 1));
  return {
    readPage: vi.fn(
      async (_tx: CoverageTx, _cid: string, after: string | null, limit: number) => {
        const start = after === null ? 0 : sorted.findIndex((row) => row.saleId > after);
        const from = start === -1 ? sorted.length : start;
        const page = sorted.slice(from, from + Math.min(limit, pageSize));
        const last = page.at(-1);
        const more = from + page.length < sorted.length;
        return { rows: page, nextAfter: page.length > 0 && more && last ? last.saleId : null };
      },
    ),
  };
}

function projectionReader(projected: readonly SaleCoverageRow[]) {
  const map = new Map(projected.map((row) => [row.saleId, row]));
  return {
    saleRevisions: vi.fn(async (_tx: CoverageTx, _cid: string, ids: readonly string[]) =>
      ids.map((id) => map.get(id)).filter((row): row is SaleCoverageRow => row !== undefined),
    ),
  } as unknown as CoverageProjectionReader;
}

function runner(log: string[]): CoverageTenantRunner {
  return vi.fn(async (_companyId: string, fn: (tx: CoverageTx) => Promise<unknown>) => {
    log.push('tx');
    return fn(DUMMY_TX);
  }) as unknown as CoverageTenantRunner;
}

describe('checkSaleCoverage: the comparison', () => {
  it('reports covered when every sale row holds the source revision', async () => {
    const source = sourceReader([
      { saleId: saleId(1), revision: 2 },
      { saleId: saleId(2), revision: 1 },
    ]);
    const result = await checkSaleCoverage({
      withTenant: runner([]),
      sales: source as unknown as PackageSaleCoverageReader,
      projection: projectionReader([
        { saleId: saleId(1), revision: 2 },
        { saleId: saleId(2), revision: 1 },
      ]),
      companyId: COMPANY,
    });
    expect(result).toEqual({
      checked: 2,
      missing: { total: 0, ids: [] },
      stale: { total: 0, ids: [] },
      truncated: false,
    });
  });

  it('lists a sale with no projection row as missing', async () => {
    const result = await checkSaleCoverage({
      withTenant: runner([]),
      sales: sourceReader([{ saleId: saleId(1), revision: 1 }]) as unknown as PackageSaleCoverageReader,
      projection: projectionReader([]),
      companyId: COMPANY,
    });
    expect(result.missing).toEqual({ total: 1, ids: [saleId(1)] });
    expect(result.stale.total).toBe(0);
  });

  it('lists a sale whose projected revision is below the source as stale', async () => {
    const result = await checkSaleCoverage({
      withTenant: runner([]),
      sales: sourceReader([{ saleId: saleId(1), revision: 3 }]) as unknown as PackageSaleCoverageReader,
      projection: projectionReader([{ saleId: saleId(1), revision: 2 }]),
      companyId: COMPANY,
    });
    expect(result.stale).toEqual({ total: 1, ids: [saleId(1)] });
    expect(result.missing.total).toBe(0);
  });
});

describe('checkSaleCoverage: paging', () => {
  it('pages the source with keyset cursors until the last page', async () => {
    const txLog: string[] = [];
    const source = sourceReader([
      { saleId: saleId(1), revision: 1 },
      { saleId: saleId(2), revision: 1 },
      { saleId: saleId(3), revision: 1 },
    ]);
    const result = await checkSaleCoverage({
      withTenant: runner(txLog),
      sales: source as unknown as PackageSaleCoverageReader,
      projection: projectionReader([
        { saleId: saleId(1), revision: 1 },
        { saleId: saleId(2), revision: 1 },
        { saleId: saleId(3), revision: 1 },
      ]),
      companyId: COMPANY,
    });
    expect(result.checked).toBe(3);
    expect(source.readPage.mock.calls[1]?.[2]).toBe(saleId(2));
    expect(txLog).toEqual(['tx', 'tx']);
  });

  it('opens one read transaction per page on the report company only', async () => {
    const txLog: string[] = [];
    const withTenant = vi.fn(async (companyId: string, fn: (tx: CoverageTx) => Promise<unknown>) => {
      txLog.push(companyId);
      return fn(DUMMY_TX);
    }) as unknown as CoverageTenantRunner;
    await checkSaleCoverage({
      withTenant,
      sales: sourceReader([
        { saleId: saleId(1), revision: 1 },
        { saleId: saleId(2), revision: 1 },
        { saleId: saleId(3), revision: 1 },
      ]) as unknown as PackageSaleCoverageReader,
      projection: projectionReader([]),
      companyId: COMPANY,
    });
    expect(txLog).toEqual([COMPANY, COMPANY]);
  });
});

describe('checkSaleCoverage: the diagnostic cap', () => {
  it('keeps the full total past the diagnostic cap and retains exactly the first REPORT_LIST_LIMIT ids across pages', async () => {
    // 201 بيع ناقص يقطع الحد الفعلي 200: التقرير يحفظ العدد الكامل وأول 200 هوية بالترتيب ويرية الاقتطاع،
    // عبر خمس صفحات، فلا يُقرأ الحد كنجاح ولا يُخمَّن أي هوية سقطت من القائمة.
    const total = REPORT_LIST_LIMIT + 1;
    const many: SaleCoverageRow[] = Array.from({ length: total }, (_, index) => ({
      saleId: saleId(index + 1),
      revision: 1,
    }));
    const source = sourceReader(many, 50);
    const result = await checkSaleCoverage({
      withTenant: runner([]),
      sales: source as unknown as PackageSaleCoverageReader,
      projection: projectionReader([]),
      companyId: COMPANY,
    });
    expect(result.checked).toBe(total);
    expect(result.missing.total).toBe(total);
    expect(result.missing.ids).toHaveLength(REPORT_LIST_LIMIT);
    expect(result.missing.ids).toEqual(
      many.slice(0, REPORT_LIST_LIMIT).map((row) => row.saleId),
    );
    expect(result.missing.ids).not.toContain(many[total - 1]?.saleId);
    expect(result.stale).toEqual({ total: 0, ids: [] });
    expect(result.truncated).toBe(true);
    // صفحات متعددة بالفعل: 201 صف بحجم صفحة 50 يعني خمس معاملات قراءة.
    expect(source.readPage).toHaveBeenCalledTimes(5);
  });
});
