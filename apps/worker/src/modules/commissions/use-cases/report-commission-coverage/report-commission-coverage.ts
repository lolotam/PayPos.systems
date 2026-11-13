import {
  compareCoverage,
  coverageKey,
  findUnmarkedEventIds,
  type CoverageComparison,
} from '@pospay/commissions-engine';

import type {
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
    readonly events: readonly { eventId: string; eventType: string }[];
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

interface ReportState {
  truncated: boolean;
}

interface CheckContext {
  readonly deps: CommissionCoverageDeps;
  readonly companyId: string;
  readonly state: ReportState;
}

interface CoverageTotals {
  checked: number;
  missingTotal: number;
  staleTotal: number;
  readonly missingIds: string[];
  readonly staleIds: string[];
}

interface UnmarkedResult {
  throughId: string | null;
  checked: number;
  total: number;
  readonly events: { eventId: string; eventType: string }[];
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
  const context: CheckContext = {
    deps,
    companyId: scope.companyId.toLowerCase(),
    state: { truncated: false },
  };
  const lines = await checkLines(context);
  const salaries = await checkSalaries(context);
  const unmarked = await checkUnmarked(context, scope.throughId);
  const covered =
    lines.missing.total === 0 &&
    lines.stale.total === 0 &&
    salaries.missing.total === 0 &&
    salaries.stale.total === 0 &&
    unmarked.total === 0;
  return {
    status: covered ? 'COVERED' : 'NOT_COVERED',
    throughId: unmarked.throughId,
    lines,
    salaries,
    unmarked: {
      checked: unmarked.checked,
      total: unmarked.total,
      events: unmarked.events,
    },
    truncated: context.state.truncated,
  };
}

async function checkLines(context: CheckContext): Promise<CommissionCoverageReport['lines']> {
  const totals = emptyCoverageTotals();
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
    collectCoverage(totals, result.comparison, context.state);
    after = result.nextAfter;
    if (after === null) return coverageResult(totals);
  }
}

async function checkSalaries(context: CheckContext): Promise<CommissionCoverageReport['salaries']> {
  const totals = emptyCoverageTotals();
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
    collectCoverage(totals, result.comparison, context.state);
    after = result.next;
    if (after === null) return coverageResult(totals);
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
): Promise<UnmarkedResult> {
  const result: UnmarkedResult = {
    throughId: requestedThroughId,
    checked: 0,
    total: 0,
    events: [],
  };
  let afterId: string | null = null;
  let firstPage = true;
  for (;;) {
    const page = await context.deps.retained.commissionInputReplayPage(
      context.companyId,
      afterId,
      result.throughId,
      RETAINED_PAGE_SIZE,
    );
    if (firstPage) {
      result.throughId = page.throughId;
      firstPage = false;
    }
    if (page.events.length === 0) return result;
    for (const event of page.events) {
      if (event.companyId !== context.companyId) {
        throw new CommissionCoverageEventInvalidError();
      }
    }
    const eventIds = page.events.map((event) => event.id);
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
      .filter((event) => unmarkedSet.has(event.id))
      .map((event) => ({ eventId: event.id, eventType: event.eventType }));
    pushCapped(result.events, events, context.state);
    result.checked += page.events.length;
    result.total += unmarkedIds.length;
    afterId = page.events.at(-1)?.id ?? afterId;
    if (page.events.length < RETAINED_PAGE_SIZE) return result;
  }
}

function emptyCoverageTotals(): CoverageTotals {
  return { checked: 0, missingTotal: 0, staleTotal: 0, missingIds: [], staleIds: [] };
}

function collectCoverage(
  totals: CoverageTotals,
  comparison: CoverageComparison,
  state: ReportState,
): void {
  totals.checked += comparison.checked;
  totals.missingTotal += comparison.missing.length;
  totals.staleTotal += comparison.stale.length;
  pushCapped(totals.missingIds, comparison.missing, state);
  pushCapped(totals.staleIds, comparison.stale, state);
}

function pushCapped<T>(target: T[], additions: readonly T[], state: ReportState): void {
  if (target.length + additions.length > REPORT_LIST_LIMIT) state.truncated = true;
  target.push(...additions.slice(0, Math.max(0, REPORT_LIST_LIMIT - target.length)));
}

function coverageResult(totals: CoverageTotals): CommissionCoverageReport['lines'] {
  return {
    checked: totals.checked,
    missing: { total: totals.missingTotal, ids: totals.missingIds },
    stale: { total: totals.staleTotal, ids: totals.staleIds },
  };
}
