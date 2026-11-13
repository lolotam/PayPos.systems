import type { ClaimedEvent } from '@pospay/db';
import { describe, expect, it, vi } from 'vitest';

import type {
  CoverageTenantRunner,
  CoverageTx,
  SalaryCoverageRow,
  ServiceLineCoverageRow,
  TipCoverageRow,
} from '../ports/commission-coverage.port.ts';
import type { BootstrapTipPage, CurrentTipSessionsReader } from '../ports/commission-tip-bootstrap.port.ts';
import {
  runCommissionCoverageReport,
  type CommissionCoverageDeps,
  type CommissionCoverageScope,
} from '../use-cases/report-commission-coverage/report-commission-coverage.ts';

const COMPANY = '01920000-0000-7000-8000-0000000000a0';
const CONSUMER = 'commission-coverage';
const BUSINESS = '01920000-0000-7000-8000-0000000000c1';
// القارئات ما بتمسّش الـ tx، فكائن فارغ بيناسب الـ port من غير أي جدول حقيقي.
const DUMMY_TX = {} as unknown as CoverageTx;
// النص المعلن في التقرير لما البقشيش ما اتفحصش؛ لازم ما يتغيّرش من غير قرار.
const TIPS_NOT_CHECKED =
  'Tip coverage by revision was NOT checked: pass --businesses <uuid>[,<uuid>...] --from YYYY-MM-DD --to YYYY-MM-DD to check it.';

const HANDLED_TYPES = new Set([
  'ServiceSessionRecorded',
  'ServiceSessionLinesAdded',
  'ServiceLineChanged',
  'SessionTipsChanged',
  'SalaryChanged',
]);

const eventId = (n: number | string): string =>
  `01970000-0000-7000-8000-${String(n).padStart(12, '0')}`;
const sessionId = (n: number): string =>
  `01990000-0000-7000-8000-${String(n).padStart(12, '0')}`;

const event = (n: number | string, kind: string): ClaimedEvent => ({
  companyId: COMPANY,
  id: eventId(n),
  aggregateType: 'service_session',
  aggregateId: eventId(n),
  eventType: kind,
  payload: { sensitive: 'leak-me' },
  attempt: 1,
});

const tipSession = (n: number, revision: number) => ({
  sessionId: sessionId(n),
  businessId: BUSINESS,
  businessDate: '2026-11-01',
  branchId: '01920000-0000-7000-8000-0000000000b1',
  revision,
  tips: [],
  eventIds: [],
});

function emptyLineReader() {
  return {
    readPage: vi.fn(async () => ({ rows: [] as readonly ServiceLineCoverageRow[], nextAfter: null })),
  };
}

function emptySalaryReader() {
  return {
    readPage: vi.fn(async () => ({
      rows: [] as readonly SalaryCoverageRow[],
      next: null,
    })),
  };
}

function projectionReader(options: {
  readonly tips?: readonly TipCoverageRow[];
  readonly marked?: ReadonlySet<string>;
}) {
  const tips = new Map((options.tips ?? []).map((row) => [row.sessionId, row]));
  const marked = options.marked ?? new Set<string>();  return {
    lineRevisions: vi.fn(async () => [] as readonly ServiceLineCoverageRow[]),
    salaryRevisions: vi.fn(async () => [] as readonly SalaryCoverageRow[]),
    markedEventIds: vi.fn(
      async (_tx: CoverageTx, _cid: string, _consumer: string, ids: readonly string[]) =>
        new Set(ids.filter((id) => marked.has(id.toLowerCase())).map((id) => id.toLowerCase())),
    ),
    tipRevisions: vi.fn(async (_tx: CoverageTx, _cid: string, ids: readonly string[]) =>
      ids.map((id) => tips.get(id)).filter((row): row is TipCoverageRow => row !== undefined),
    ),
  };
}

function retainedReader(events: readonly ClaimedEvent[]) {
  const sorted = [...events].sort((left, right) =>
    left.id.toLowerCase() < right.id.toLowerCase() ? -1 : 1,
  );
  return {
    commissionRetainedEventPage: vi.fn(
      async (companyId: string, afterId: string | null, throughId: string | null, limit: number) => {
        const end = throughId ?? sorted.at(-1)?.id ?? null;
        if (end === null) return { throughId: null, events: [] };
        const bound = end.toLowerCase();
        const cursor = (afterId ?? '').toLowerCase();
        const page = sorted.filter(
          (item) =>
            item.companyId.toLowerCase() === companyId.toLowerCase() &&
            item.id.toLowerCase() > cursor &&
            item.id.toLowerCase() <= bound,
        );
        return { throughId: end, events: page.slice(0, limit) };
      },
    ),
  };
}

function tipsReader(sessions: readonly ReturnType<typeof tipSession>[]): CurrentTipSessionsReader {
  return {
    readPage: vi.fn(
      async (
        _tx: CoverageTx,
        _companyId: string,
        businessId: string,
        range: { readonly from: string; readonly to: string },
        page: {
          readonly after: { readonly businessDate: string; readonly sessionId: string } | null;
          readonly limit: number;
        },
      ): Promise<BootstrapTipPage> => ({
        items: sessions
          .filter(
            (item) =>
              item.businessId === businessId &&
              item.businessDate >= range.from &&
              item.businessDate <= range.to,
          )
          .slice(0, page.limit),
        nextCursor: null,
      }),
    ),
  };
}

interface HarnessOptions {
  readonly events?: readonly ClaimedEvent[];
  readonly marked?: ReadonlySet<string>;
  readonly tips?: readonly TipCoverageRow[];
  readonly sessions?: readonly ReturnType<typeof tipSession>[];
}

function harness(options: HarnessOptions) {
  const withTenant: CoverageTenantRunner = async <T>(
    _companyId: string,
    fn: (tx: CoverageTx) => Promise<T>,
  ): Promise<T> => fn(DUMMY_TX);
  const deps: CommissionCoverageDeps = {
    withTenant,
    lines: emptyLineReader(),
    salaries: emptySalaryReader(),
    projection: projectionReader({
      ...(options.tips === undefined ? {} : { tips: options.tips }),
      ...(options.marked === undefined ? {} : { marked: options.marked }),
    }),
    retained: retainedReader(options.events ?? []),
    companies: { isOpen: async () => true },
    consumerId: CONSUMER,
    handledTypes: HANDLED_TYPES,
    tipsReader: tipsReader(options.sessions ?? []),
  };
  return { deps };
}

const tipScope: CommissionCoverageScope['tips'] = {
  businessIds: [BUSINESS],
  from: '2026-11-01',
  to: '2026-11-30',
};

const run = (
  deps: CommissionCoverageDeps,
  scope: Partial<CommissionCoverageScope> = {},
): Promise<Awaited<ReturnType<typeof runCommissionCoverageReport>>> =>
  runCommissionCoverageReport(deps, { companyId: COMPANY, throughId: null, ...scope });

describe('runCommissionCoverageReport: the tip coverage by revision', () => {
  it('says the tips were NOT checked when no tip scope was supplied', async () => {
    const { deps } = harness({});

    const report = await run(deps);

    expect(report.tips).toBeNull();
    expect(report.tipsNote).toBe(TIPS_NOT_CHECKED);
    expect(report.status).toBe('COVERED');
  });

  it('counts a missing session, a stale revision and a covered one and refuses coverage', async () => {
    const { deps } = harness({
      sessions: [tipSession(1, 4), tipSession(2, 2), tipSession(3, 7)],
      tips: [{ sessionId: sessionId(2), revision: 1 }, { sessionId: sessionId(3), revision: 7 }],
    });

    const report = await run(deps, { tips: tipScope });

    expect(report.tips).toEqual({
      checked: 3,
      missing: { total: 1, ids: [sessionId(1)] },
      stale: { total: 1, ids: [sessionId(2)] },
    });
    expect(report.tipsNote).toBeNull();
    expect(report.status).toBe('NOT_COVERED');
  });

  it('reports COVERED with a null note when every tip revision is covered', async () => {
    const { deps } = harness({
      sessions: [tipSession(1, 4), tipSession(2, 2)],
      tips: [{ sessionId: sessionId(1), revision: 4 }, { sessionId: sessionId(2), revision: 9 }],
    });

    const report = await run(deps, { tips: tipScope });

    expect(report.tips).toEqual({
      checked: 2,
      missing: { total: 0, ids: [] },
      stale: { total: 0, ids: [] },
    });
    expect(report.tipsNote).toBeNull();
    expect(report.status).toBe('COVERED');
  });
});

describe('runCommissionCoverageReport: the six-type retained events', () => {
  it('lists a retained tip event without its mark under unmarked', async () => {
    const tipsEvent = event(1, 'SessionTipsChanged');
    const { deps } = harness({ events: [tipsEvent], marked: new Set<string>() });

    const report = await run(deps);

    expect(report.unmarked).toEqual({
      checked: 1,
      total: 1,
      events: [{ eventId: tipsEvent.id, type: 'SessionTipsChanged' }],
    });
    expect(report.notHandled).toEqual({ total: 0, events: [] });
    expect(report.status).toBe('NOT_COVERED');
  });

  it('lists a retained package sale under notHandled and never under unmarked', async () => {
    const packageSale = event(2, 'PackageSaleChanged');
    const { deps } = harness({ events: [packageSale], marked: new Set<string>() });

    const report = await run(deps);

    expect(report.notHandled).toEqual({
      total: 1,
      events: [
        { eventId: packageSale.id, type: 'PackageSaleChanged', reason: 'COMMISSION_EVENT_TYPE_NOT_HANDLED' },
      ],
    });
    expect(report.unmarked.total).toBe(0);
    expect(report.unmarked.events).toEqual([]);
    expect(report.status).toBe('NOT_COVERED');
  });

  it('covers a tenant with no package sale row once everything else is marked', async () => {
    const markedEvent = event(1, 'ServiceSessionRecorded');
    const { deps } = harness({
      events: [markedEvent],
      marked: new Set([markedEvent.id.toLowerCase()]),
    });

    const report = await run(deps);

    expect(report.notHandled.total).toBe(0);
    expect(report.unmarked.total).toBe(0);
    expect(report.status).toBe('COVERED');
  });

  it('accepts a through id that is a retained package sale event', async () => {
    const packageSale = event(2, 'PackageSaleChanged');
    const { deps } = harness({ events: [packageSale], marked: new Set<string>() });

    const report = await run(deps, { throughId: packageSale.id });

    expect(report.throughId).toBe(packageSale.id);
    expect(report.notHandled.total).toBe(1);
    expect(report.status).toBe('NOT_COVERED');
  });
});
