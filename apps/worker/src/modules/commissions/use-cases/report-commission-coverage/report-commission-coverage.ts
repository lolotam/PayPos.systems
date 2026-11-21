import {
  addComparison,
  compareCoverage,
  coverageKey,
  emptyCoverageTotals,
  type CoverageTotals,
} from '@pospay/commissions-engine';

import type {
  CoverageCompanyReader,
  CoverageProjectionReader,
  CoverageRetainedPageReader,
  CoverageTenantRunner,
  PackageSaleCoverageReader,
  SalaryCoverageReader,
  SalaryCoverageRow,
  ServiceLineCoverageReader,
} from '../../ports/commission-coverage.port.ts';
import type { CurrentTipSessionsReader } from '../../ports/commission-tip-bootstrap.port.ts';
import {
  checkUnmarked,
  REPORT_LIST_LIMIT,
  type NotHandledEvent,
  type UnmarkedEvent,
} from './check-retained-events.ts';
import { checkSaleCoverage } from './check-sale-coverage.ts';
import { checkTipCoverage, type TipCoverageResult } from './check-tip-coverage.ts';

export { CommissionCoverageEventInvalidError } from './check-retained-events.ts';

const SOURCE_PAGE_SIZE = 200;
// النص يشرح أن البقشيش لم يُفحص وكيف يفحصه المشغّل، فلا يُقرأ كنتيجة نجاح.
const TIPS_NOT_CHECKED_NOTE =
  'Tip coverage by revision was NOT checked: pass --businesses <uuid>[,<uuid>...] --from YYYY-MM-DD --to YYYY-MM-DD to check it.';

/** نطاق التقرير: شركة واحدة وحد أعلى ثابت للأحداث المحتفظ بها، أو أحدث حدث عند البدء. */
export interface CommissionCoverageScope {
  readonly companyId: string;
  readonly throughId: string | null;
  /** نطاق فحص البقشيش بالمراجعة؛ بدونه لا يُفحص البقشيش ويقول التقرير ذلك صراحة. */
  readonly tips?: {
    readonly businessIds: readonly string[];
    readonly from: string;
    readonly to: string;
  };
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
  readonly sales: {
    readonly checked: number;
    readonly missing: CoverageIdList;
    readonly stale: CoverageIdList;
  };
  readonly unmarked: {
    readonly checked: number;
    readonly total: number;
    readonly events: readonly UnmarkedEvent[];
  };
  /** الأحداث التي لا يسجّل المستهلك لنوعها؛ رمز ثابت واحد يفرق نوعاً غير مسجَّل عن فجوة حقيقية. */
  readonly notHandled: {
    readonly total: number;
    readonly events: readonly NotHandledEvent[];
  };
  readonly tips: {
    readonly checked: number;
    readonly missing: CoverageIdList;
    readonly stale: CoverageIdList;
  } | null;
  readonly tipsNote: string | null;
  readonly truncated: boolean;
}

/** منافذ القراءة التي يحتاجها التقرير؛ الربط الفعلي يبقى في جذر التركيب. */
export interface CommissionCoverageDeps {
  readonly withTenant: CoverageTenantRunner;
  readonly lines: ServiceLineCoverageReader;
  readonly salaries: SalaryCoverageReader;
  readonly sales: PackageSaleCoverageReader;
  readonly projection: CoverageProjectionReader;
  readonly retained: CoverageRetainedPageReader;
  readonly companies: CoverageCompanyReader;
  readonly consumerId: string;
  /** أنواع الأحداث التي يسجّلها المستهلك؛ الحدث من نوع آخر لا يُفحص في العلامات ولا يُسلّم. */
  readonly handledTypes: ReadonlySet<string>;
  /** قارئ الزيارات التي لها بقشيش؛ لازم لفحص البقشيش بالمراجعة. */
  readonly tipsReader?: CurrentTipSessionsReader;
}

/** نطاق لا يمكن التقرير عنه: شركة غير موجودة أو حد أعلى ليس حدثاً محتفظاً بها. */
export class CommissionCoverageScopeInvalidError extends Error {
  readonly code = 'COMMISSION_COVERAGE_SCOPE_INVALID';

  constructor() {
    super('COMMISSION_COVERAGE_SCOPE_INVALID');
    this.name = 'CommissionCoverageScopeInvalidError';
  }
}

const CALENDAR_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * يرفض التواريخ التي يقبلها شكل YYYY-MM-DD ولا وجود لها في التقويم، لأن فحص البقشيش
 * بنطاق محوّل تلقائياً إلى يوم آخر يعطي المشغّل نتيجة تغطية عن نطاق لم يطلبه.
 *
 * @param value التاريخ النصي المطلوب فحصه
 * @returns true فقط لتاريخ تقويمي حقيقي بصيغة YYYY-MM-DD، للسنوات 0001-9999 لأن PostgreSQL لا يحتوي على سنة صفرية
 */
export function isCommissionCoverageCalendarDate(value: string): boolean {
  const match = CALENDAR_DATE.exec(value);
  if (match === null) return false;
  const year = Number(match[1]);
  if (year === 0) return false;
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(2000, 0, 1));
  date.setUTCFullYear(year, month - 1, day);
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

interface CheckContext {
  readonly deps: CommissionCoverageDeps;
  readonly companyId: string;
}

/** تحسب حالة الاعتماد: كل قسم مغطى، ولا حدث غير مستهلك ولا نوع غير مسجَّل ولا بقشيش متأخر. */
function coverageStatus(
  parts: readonly { missing: { total: number }; stale: { total: number } }[],
  unmarkedTotal: number,
  notHandledTotal: number,
  tips: TipCoverageResult | null,
): boolean {
  const sectionsCovered = parts.every(
    (part) => part.missing.total === 0 && part.stale.total === 0,
  );
  return (
    sectionsCovered &&
    unmarkedTotal === 0 &&
    notHandledTotal === 0 &&
    (tips === null || (tips.missing.total === 0 && tips.stale.total === 0))
  );
}

/** يرفض نطاق بقشيش بتواريخ غير تقويمية قبل أي قراءة، لأن تحويله التلقائي يفحص نطاقاً آخر. */
function assertTipScopeCalendar(scope: CommissionCoverageScope): void {
  if (scope.tips !== undefined &&
    (!isCommissionCoverageCalendarDate(scope.tips.from) ||
      !isCommissionCoverageCalendarDate(scope.tips.to)))
    throw new CommissionCoverageScopeInvalidError();
}

/** يرفض حدّاً أعلى لا يساوي آخر حدث مقروء، لأن الاستئناف بنطاق مختلف يضيّع أحداثاً بين الحدين. */
function assertStableThroughId(lastEventId: string | null, requestedThroughId: string | null): void {
  const resolved = requestedThroughId?.toLowerCase() ?? null;
  if (requestedThroughId !== null && lastEventId !== resolved) {
    throw new CommissionCoverageScopeInvalidError();
  }
}

/**
 * يثبت أن بنود الخدمة والرواتب والبيع والأحداث المحتفظ بها مغطاة قبل اعتماد كشف العمولة.
 * ثبوت الحد الأعلى من أول صفحة يمنع الأحداث الجديدة من تغيير نطاق الفحص أثناء تشغيله.
 *
 * @param deps قارئات المصدر والإسقاط والأحداث المحتفظ بها ومعرّف المستهلك وأنواعه
 * @param scope الشركة والحد الأعلى الاختياري لفحص الأحداث المحتفظ بها ونطاق البقشيش الاختياري
 * @returns حالة التغطية والأعداد والهويات الناقصة أو المتأخرة أو غير المستهلكة
 */
export async function runCommissionCoverageReport(
  deps: CommissionCoverageDeps,
  scope: CommissionCoverageScope,
): Promise<CommissionCoverageReport> {
  assertTipScopeCalendar(scope);
  const companyId = scope.companyId.toLowerCase();
  const open = await deps.withTenant(companyId, (tx) => deps.companies.isOpen(tx, companyId));
  if (!open) throw new CommissionCoverageScopeInvalidError();
  const context: CheckContext = {
    deps,
    companyId,
  };
  const lineTotals = await checkLines(context);
  const salaryTotals = await checkSalaries(context);
  const saleTotals = await checkSales(context);
  const unmarked = await checkUnmarked(context, scope.throughId);
  assertStableThroughId(unmarked.lastEventId, scope.throughId);
  const tips = await checkTips(context, scope);
  const covered = coverageStatus(
    [lineTotals, salaryTotals, saleTotals],
    unmarked.totals.unmarked.total,
    unmarked.notHandled.unmarked.total,
    tips,
  );
  return {
    status: covered ? 'COVERED' : 'NOT_COVERED',
    throughId: unmarked.throughId,
    lines: coverageResult(lineTotals),
    salaries: coverageResult(salaryTotals),
    sales: {
      checked: saleTotals.checked,
      missing: saleTotals.missing,
      stale: saleTotals.stale,
    },
    unmarked: {
      checked: unmarked.totals.checked,
      total: unmarked.totals.unmarked.total,
      events: unmarked.totals.unmarked.items,
    },
    notHandled: {
      total: unmarked.notHandled.unmarked.total,
      events: unmarked.notHandled.unmarked.items,
    },
    tips:
      tips === null
        ? null
        : { checked: tips.checked, missing: tips.missing, stale: tips.stale },
    tipsNote: tips === null ? TIPS_NOT_CHECKED_NOTE : null,
    truncated:
      lineTotals.missing.truncated ||
      lineTotals.stale.truncated ||
      salaryTotals.missing.truncated ||
      salaryTotals.stale.truncated ||
      saleTotals.truncated ||
      unmarked.totals.unmarked.truncated ||
      unmarked.notHandled.unmarked.truncated ||
      (tips !== null && tips.truncated),
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

/** يفحص بيع الباقات بالمراجعة للشركة كلها، بنفس قاعدة البنود (CS-Q41) وبلا نطاق مشغّل. */
async function checkSales(
  context: CheckContext,
): Promise<ReturnType<typeof checkSaleCoverage>> {
  return checkSaleCoverage({
    withTenant: context.deps.withTenant,
    sales: context.deps.sales,
    projection: context.deps.projection,
    companyId: context.companyId,
  });
}

/** يفحص البقشيش بالمراجعة إذا طلب المشغّل نطاقاً؛ بدون نطاق لا فحص والورقة تشرح ذلك. */
async function checkTips(
  context: CheckContext,
  scope: CommissionCoverageScope,
): Promise<TipCoverageResult | null> {
  if (scope.tips === undefined) return null;
  const tipsReader = context.deps.tipsReader;
  if (tipsReader === undefined) throw new CommissionCoverageScopeInvalidError();
  return checkTipCoverage({
    withTenant: context.deps.withTenant,
    projection: context.deps.projection,
    tipsReader,
    companyId: context.companyId,
    scope: scope.tips,
  });
}

function coverageResult(totals: CoverageTotals): CommissionCoverageReport['lines'] {
  return {
    checked: totals.checked,
    missing: { total: totals.missing.total, ids: totals.missing.items },
    stale: { total: totals.stale.total, ids: totals.stale.items },
  };
}
