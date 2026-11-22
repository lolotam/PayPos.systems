import type { ClaimedEvent } from '@pospay/db';
import { describe, expect, it, vi } from 'vitest';

import type {
  CoverageBusinessReader,
  CoverageTenantRunner,
  CoverageTx,
} from '../ports/commission-coverage.port.ts';
import {
  commissionCoverageExitCode,
  CommissionCoverageScopeInvalidError,
  runCommissionCoverageReport,
  type CommissionCoverageDeps,
  type CommissionCoverageScope,
} from '../use-cases/report-commission-coverage/report-commission-coverage.ts';

const COMPANY = '01920000-0000-7000-8000-0000000000a0';
const BUSINESS = '01920000-0000-7000-8000-0000000000c1';
const FOREIGN_BUSINESS = '01920000-0000-7000-8000-0000000000d1';
const EVENT_ID = '01970000-0000-7000-8000-000000000001';
const DUMMY_TX = {} as unknown as CoverageTx;
const SCOPE_INVALID = { code: 'COMMISSION_COVERAGE_SCOPE_INVALID' };
const TIP_SCOPE = { businessIds: [BUSINESS], from: '2026-11-01', to: '2026-11-30' };

const HANDLED_TYPES = new Set([
  'ServiceSessionRecorded',
  'ServiceSessionLinesAdded',
  'ServiceLineChanged',
  'SessionTipsChanged',
  'SalaryChanged',
  'PackageSaleChanged',
]);

const retainedEvent = (): ClaimedEvent => ({
  companyId: COMPANY,
  id: EVENT_ID,
  aggregateType: 'service_session',
  aggregateId: EVENT_ID,
  eventType: 'ServiceSessionRecorded',
  payload: {},
  attempt: 1,
});

/**
 * كل المصادر والإسقاط فارغة ومتطابقة، فلا فجوة في أي مراجعة؛ الحدث المحتفظ به الوحيد (إن وُجد)
 * هو ما يقرر. بذلك يعزل كل اختبار هنا قاعدة نطاق واحدة أو فحصاً واحداً.
 */
function harness(options: { readonly retained?: readonly ClaimedEvent[]; readonly member?: boolean }) {
  const retained = options.retained ?? [];
  const withTenant = vi.fn(async (_companyId: string, fn: (tx: CoverageTx) => Promise<unknown>) =>
    fn(DUMMY_TX),
  ) as unknown as CoverageTenantRunner;
  const deps = {
    withTenant,
    lines: { readPage: vi.fn(async () => ({ rows: [], nextAfter: null })) },
    salaries: { readPage: vi.fn(async () => ({ rows: [], next: null })) },
    sales: { readPage: vi.fn(async () => ({ rows: [], nextAfter: null })) },
    projection: {
      lineRevisions: vi.fn(async () => []),
      salaryRevisions: vi.fn(async () => []),
      saleRevisions: vi.fn(async () => []),
      tipRevisions: vi.fn(async () => []),
      markedEventIds: vi.fn(async () => new Set<string>()),
    },
    retained: {
      commissionRetainedEventPage: vi.fn(async () => ({
        throughId: retained.at(-1)?.id ?? null,
        events: retained,
      })),
    },
    companies: { isOpen: vi.fn(async () => true) },
    businesses: {
      isInCompany: vi.fn<CoverageBusinessReader['isInCompany']>(async () => options.member ?? true),
    },
    consumerId: 'commission-coverage',
    handledTypes: HANDLED_TYPES,
    tipsReader: { readPage: vi.fn(async () => ({ items: [], nextCursor: null })) },
  } satisfies CommissionCoverageDeps;
  return deps;
}

const run = (deps: CommissionCoverageDeps, scope: Partial<CommissionCoverageScope> = {}) =>
  runCommissionCoverageReport(deps, { companyId: COMPANY, throughId: null, ...scope });

function expectNothingScanned(deps: ReturnType<typeof harness>) {
  expect(deps.lines.readPage).not.toHaveBeenCalled();
  expect(deps.salaries.readPage).not.toHaveBeenCalled();
  expect(deps.sales.readPage).not.toHaveBeenCalled();
  expect(deps.retained.commissionRetainedEventPage).not.toHaveBeenCalled();
  expect(deps.tipsReader.readPage).not.toHaveBeenCalled();
}

describe('the tip scope refusals (issue #1032)', () => {
  it('refuses an empty business list in the use case before any read', async () => {
    const deps = harness({});

    const failure = run(deps, { tips: { ...TIP_SCOPE, businessIds: [] } });

    await expect(failure).rejects.toBeInstanceOf(CommissionCoverageScopeInvalidError);
    await expect(failure).rejects.toMatchObject(SCOPE_INVALID);
    expect(deps.withTenant).not.toHaveBeenCalled();
    expectNothingScanned(deps);
  });

  it.each([
    { name: 'a business id that is not a UUID', tips: { ...TIP_SCOPE, businessIds: ['not-a-uuid'] } },
    { name: 'a range that ends before it starts', tips: { ...TIP_SCOPE, from: '2026-12-01', to: '2026-11-01' } },
  ])('refuses $name before any read', async ({ tips }) => {
    const deps = harness({});

    await expect(run(deps, { tips })).rejects.toMatchObject(SCOPE_INVALID);

    expect(deps.withTenant).not.toHaveBeenCalled();
    expectNothingScanned(deps);
  });

  it('refuses a business that is not the company\'s without scanning anything', async () => {
    const deps = harness({ member: false });

    const failure = run(deps, { tips: { ...TIP_SCOPE, businessIds: [FOREIGN_BUSINESS] } });

    await expect(failure).rejects.toMatchObject(SCOPE_INVALID);
    expect(deps.businesses.isInCompany).toHaveBeenCalledWith(DUMMY_TX, COMPANY, FOREIGN_BUSINESS);
    expectNothingScanned(deps);
  });

  it('refuses a list where only one of the businesses is foreign', async () => {
    const deps = harness({});
    deps.businesses.isInCompany.mockImplementation(async (_tx, _company, id) => id === BUSINESS);

    const failure = run(deps, { tips: { ...TIP_SCOPE, businessIds: [BUSINESS, FOREIGN_BUSINESS] } });

    await expect(failure).rejects.toMatchObject(SCOPE_INVALID);
    expectNothingScanned(deps);
  });

  it('checks each distinct business once and prints the normalised scope it checked', async () => {
    const deps = harness({});

    const report = await run(deps, {
      tips: { ...TIP_SCOPE, businessIds: [BUSINESS.toUpperCase(), BUSINESS] },
    });

    expect(deps.businesses.isInCompany).toHaveBeenCalledTimes(1);
    expect(report.tipScope).toEqual(TIP_SCOPE);
  });
});

describe('COVERED needs every check, not only the four sections (issue #1032)', () => {
  it('is COVERED with exit code 0 and names the scope when everything was checked and clean', async () => {
    const report = await run(harness({}), { tips: TIP_SCOPE });

    expect(report.status).toBe('COVERED');
    expect(report.tipScope).toEqual(TIP_SCOPE);
    expect(commissionCoverageExitCode(report)).toBe(0);
  });

  it('is NOT_COVERED with exit code 1 when no tip scope was given, and reads no tips', async () => {
    const deps = harness({});

    const report = await run(deps);

    expect(report.status).toBe('NOT_COVERED');
    expect(report.tips).toBeNull();
    expect(report.tipScope).toBeNull();
    expect(report.tipsNote).toContain('NOT checked');
    expect(commissionCoverageExitCode(report)).toBe(1);
    expect(deps.tipsReader.readPage).not.toHaveBeenCalled();
    expect(deps.businesses.isInCompany).not.toHaveBeenCalled();
  });

  it('stays NOT_COVERED with exit code 1 for a retained event without the consumer mark even when every revision is current and the tips are covered', async () => {
    const report = await run(harness({ retained: [retainedEvent()] }), { tips: TIP_SCOPE });

    expect(report.lines.missing.total + report.lines.stale.total).toBe(0);
    expect(report.salaries.missing.total + report.salaries.stale.total).toBe(0);
    expect(report.sales.missing.total + report.sales.stale.total).toBe(0);
    expect(report.tips).toEqual({
      checked: 0,
      missing: { total: 0, ids: [] },
      stale: { total: 0, ids: [] },
    });
    expect(report.unmarked.total).toBe(1);
    expect(report.status).toBe('NOT_COVERED');
    expect(commissionCoverageExitCode(report)).toBe(1);
  });
});

describe('commissionCoverageExitCode', () => {
  it.each([
    { status: 'COVERED' as const, code: 0 },
    { status: 'NOT_COVERED' as const, code: 1 },
  ])('maps $status to exit code $code', ({ status, code }) => {
    expect(commissionCoverageExitCode({ status })).toBe(code);
  });
});
