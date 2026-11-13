import {
  addComparison,
  addUnmarkedPage,
  compareCoverage,
  coverageKey,
  emptyCoverageTotals,
  emptyUnmarkedTotals,
  findUnmarkedEventIds,
  type CoverageTotals,
  type UnmarkedTotals,
} from '@pospay/commissions-engine';

import type {
  CoverageCompanyReader,
  CoverageProjectionReader,
  CoverageRetainedPageReader,
  CoverageTenantRunner,
  SalaryCoverageReader,
  SalaryCoverageRow,
  ServiceLineCoverageReader,
} from '../../ports/commission-coverage.port.ts';

const SOURCE_PAGE_SIZE = 200;
const RETAINED_PAGE_SIZE = 100;
const REPORT_LIST_LIMIT = 200;

/** نطاق التقرير: شركة واحدة وحد أعلى ثابت للأحداث المحتفظ بها، أو أحدث حدث عند البدء. */
export interface CommissionCoverageScope {
  readonly companyId: string;
  readonly throughId: string | null;
}

/** قائمة هويات محدودة للمشغّل مع العدد الكامل حتى لا يخفي السقف حجم الفجوة. */
export interface CoverageIdList {
  readonly total: number;
  readonly ids: readonly string[];
}

/** حدث محتفظ به غير مستهلك في التقرير: هويته ونوعه بلا حمولة. */
type UnmarkedEvent = { eventId: string; type: string };

/** نتيجة التغطية الخالية من الحمولات والمبالغ والأسماء، مع حالة الاعتماد وسقف القوائم. */
export interface CommissionCoverageReport {
  readonly status: 'COVERED' | 'NOT_COVERED';
  readonly throughId: string | null;
  readonly lines: {
    readonly checked: number;
    readonly missing: CoverageIdList;
    readonly stale: CoverageIdList;
  };
  readonly salaries: {
    readonly checked: number;
    readonly missing: CoverageIdList;
    readonly stale: CoverageIdList;
  };
  readonly unmarked: {
    readonly checked: number;
    readonly total: number;
    readonly events: readonly UnmarkedEvent[];
  };
  readonly truncated: boolean;
}

/** منافذ القراءة التي يحتاجها التقرير؛ الربط الفعلي يبقى في جذر التركيب. */
export interface CommissionCoverageDeps {
  readonly withTenant: CoverageTenantRunner;
  readonly lines: ServiceLineCoverageReader;
  readonly salaries: SalaryCoverageReader;
  readonly projection: CoverageProjectionReader;
  readonly retained: CoverageRetainedPageReader;
  readonly companies: CoverageCompanyReader;
  readonly consumerId: string;
}

/** حدث محتفظ به خارج شركة النطاق؛ الرفض يمنع نسبة حدث شركة أخرى إلى التقرير. */
export class CommissionCoverageEventInvalidError extends Error {
  readonly code = 'COMMISSION_COVERAGE_EVENT_INVALID';

  constructor() {
    super('COMMISSION_COVERAGE_EVENT_INVALID');
    this.name = 'CommissionCoverageEventInvalidError';
  }
}

/** نطاق لا يمكن التقرير عنه: شركة غير موجودة أو حد أعلى ليس حدثاً محتفظاً بها. */
export class CommissionCoverageScopeInvalidError extends Error {
  readonly code = 'COMMISSION_COVERAGE_SCOPE_INVALID';

  constructor() {
    super('COMMISSION_COVERAGE_SCOPE_INVALID');
    this.name = 'CommissionCoverageScopeInvalidError';
  }
}

interface CheckContext {
  readonly deps: CommissionCoverageDeps;
  readonly companyId: string;
}

interface UnmarkedCheck {
  readonly throughId: string | null;
  readonly lastEventId: string | null;
  readonly totals: UnmarkedTotals<UnmarkedEvent>;
}

/**
 * يثبت أن بنود الخدمة والرواتب والأحداث المحتفظ بها مغطاة قبل اعتماد كشف العمولة.
 * ثبوت الحد الأعلى من أول صفحة يمنع الأحداث الجديدة من تغيير نطاق الفحص أثناء تشغيله.
 *
 * @param deps قارئات المصدر والإسقاط والأحداث المحتفظ بها ومعرّف المستهلك
 * @param scope الشركة والحد الأعلى الاختياري لفحص الأحداث المحتفظ بها
 * @returns حالة التغطية والأعداد والهويات الناقصة أو المتأخرة أو غير المستهلكة
 */
export async function runCommissionCoverageReport(
  deps: CommissionCoverageDeps,
  scope: CommissionCoverageScope,
): Promise<CommissionCoverageReport> {
  const companyId = scope.companyId.toLowerCase();
  const open = await deps.withTenant(companyId, (tx) => deps.companies.isOpen(tx, companyId));
  if (!open) throw new CommissionCoverageScopeInvalidError();
  const context: CheckContext = {
    deps,
    companyId,
  };
  const lineTotals = await checkLines(context);
  const salaryTotals = await checkSalaries(context);
  const unmarked = await checkUnmarked(context, scope.throughId);
  if (scope.throughId !== null && unmarked.lastEventId !== scope.throughId.toLowerCase()) {
    throw new CommissionCoverageScopeInvalidError();
  }
  const covered =
    lineTotals.missing.total === 0 &&
    lineTotals.stale.total === 0 &&
    salaryTotals.missing.total === 0 &&
    salaryTotals.stale.total === 0 &&
    unmarked.totals.unmarked.total === 0;
  return {
    status: covered ? 'COVERED' : 'NOT_COVERED',
    throughId: unmarked.throughId,
    lines: coverageResult(lineTotals),
    salaries: coverageResult(salaryTotals),
    unmarked: {
      checked: unmarked.totals.checked,
      total: unmarked.totals.unmarked.total,
      events: unmarked.totals.unmarked.items,
    },
    truncated:
      lineTotals.missing.truncated ||
      lineTotals.stale.truncated ||
      salaryTotals.missing.truncated ||
      salaryTotals.stale.truncated ||
      unmarked.totals.unmarked.truncated,
  };
}

async function checkLines(context: CheckContext): Promise<CoverageTotals> {
  let totals = emptyCoverageTotals();
  let after: string | null = null;
  for (;;) {
    const result = await context.deps.withTenant(context.companyId, async (tx) => {
      const page = await context.deps.lines.readPage(
        tx,
        context.companyId,
        after,
        SOURCE_PAGE_SIZE,
      );
      const projected = await context.deps.projection.lineRevisions(
        tx,
        context.companyId,
        page.rows.map((row) => row.lineId),
      );
      return {
        nextAfter: page.nextAfter,
        comparison: compareCoverage(
          page.rows.map((row) => ({ key: row.lineId, revision: row.revision })),
          projected.map((row) => ({ key: row.lineId, revision: row.revision })),
        ),
      };
    });
    totals = addComparison(totals, result.comparison, REPORT_LIST_LIMIT);
    after = result.nextAfter;
    if (after === null) return totals;
  }
}

async function checkSalaries(context: CheckContext): Promise<CoverageTotals> {
  let totals = emptyCoverageTotals();
  let after: Parameters<SalaryCoverageReader['readPage']>[2] = null;
  for (;;) {
    const result = await context.deps.withTenant(context.companyId, async (tx) => {
      const page = await context.deps.salaries.readPage(
        tx,
        context.companyId,
        after,
        SOURCE_PAGE_SIZE,
      );
      const employeeIds = [...new Set(page.rows.map((row) => row.employeeId))];
      const projected = await context.deps.projection.salaryRevisions(
        tx,
        context.companyId,
        employeeIds,
      );
      return {
        next: page.next,
        comparison: compareCoverage(
          page.rows.map((row) => salaryCoverageRow(row)),
          projected.map((row) => salaryCoverageRow(row)),
        ),
      };
    });
    totals = addComparison(totals, result.comparison, REPORT_LIST_LIMIT);
    after = result.next;
    if (after === null) return totals;
  }
}

function salaryCoverageRow(row: SalaryCoverageRow) {
  return {
    key: coverageKey(row.employeeId, row.effectiveFrom),
    revision: row.revision,
  };
}

async function checkUnmarked(
  context: CheckContext,
  requestedThroughId: string | null,
): Promise<UnmarkedCheck> {
  let totals = emptyUnmarkedTotals<UnmarkedEvent>();
  let throughId = requestedThroughId;
  let lastEventId: string | null = null;
  let afterId: string | null = null;
  let firstPage = true;
  for (;;) {
    const page = await context.deps.retained.commissionInputReplayPage(
      context.companyId,
      afterId,
      throughId,
      RETAINED_PAGE_SIZE,
    );
    if (firstPage) {
      throughId = page.throughId;
      firstPage = false;
    }
    if (page.events.length === 0) return { throughId, lastEventId, totals };
    for (const event of page.events) {
      if (event.companyId.toLowerCase() !== context.companyId) {
        throw new CommissionCoverageEventInvalidError();
      }
    }
    const eventIds = page.events.map((event) => event.id.toLowerCase());
    const marked = await context.deps.withTenant(context.companyId, (tx) =>
      context.deps.projection.markedEventIds(
        tx,
        context.companyId,
        context.deps.consumerId,
        eventIds,
      ),
    );
    const unmarkedIds = findUnmarkedEventIds(eventIds, marked);
    const unmarkedSet = new Set(unmarkedIds);
    const events = page.events
      .filter((event) => unmarkedSet.has(event.id.toLowerCase()))
      .map((event) => ({ eventId: event.id, type: event.eventType }));
    totals = addUnmarkedPage(totals, page.events.length, events, REPORT_LIST_LIMIT);
    const lastEvent = page.events.at(-1);
    afterId = lastEvent?.id ?? afterId;
    lastEventId = lastEvent?.id.toLowerCase() ?? lastEventId;
    if (page.events.length < RETAINED_PAGE_SIZE) return { throughId, lastEventId, totals };
  }
}

function coverageResult(totals: CoverageTotals): CommissionCoverageReport['lines'] {
  return {
    checked: totals.checked,
    missing: { total: totals.missing.total, ids: totals.missing.items },
    stale: { total: totals.stale.total, ids: totals.stale.items },
  };
}
