import {
  addComparison,
  compareCoverage,
  coverageKey,
  emptyCoverageTotals,
  type CoverageTotals,
} from '@pospay/commissions-engine';

import type {
  CoverageBusinessReader,
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
import {
  assertCoverageScope,
  CommissionCoverageScopeInvalidError,
  normalizeTipScope,
  type CommissionCoverageTipScope,
} from './coverage-scope.ts';

export { CommissionCoverageEventInvalidError } from './check-retained-events.ts';
export {
  CommissionCoverageScopeInvalidError,
  isCommissionCoverageCalendarDate,
  type CommissionCoverageTipScope,
} from './coverage-scope.ts';

const SOURCE_PAGE_SIZE = 200;
// النص يشرح أن البقشيش لم يُفحص وكيف يفحصه المشغّل؛ ومعه تكون الحالة NOT_COVERED فلا يُقرأ كنجاح.
const TIPS_NOT_CHECKED_NOTE =
  'Tip coverage by revision was NOT checked: pass --businesses <uuid>[,<uuid>...] --from YYYY-MM-DD --to YYYY-MM-DD to check it.';

/** نطاق التقرير: شركة واحدة وحد أعلى ثابت للأحداث المحتفظ بها، أو أحدث حدث عند البدء. */
export interface CommissionCoverageScope {
  readonly companyId: string;
  readonly throughId: string | null;
  /**
   * نطاق فحص البقشيش بالمراجعة. بدونه لا يُفحص البقشيش، ويقول التقرير ذلك صراحة
   * وتكون الحالة NOT_COVERED؛ ولا افتراض لكل الأنشطة.
   */
  readonly tips?: CommissionCoverageTipScope;
}

/** قائمة هويات محدودة للمشغّل مع العدد الكامل حتى لا يخفي السقف حجم الفجوة. */
export interface CoverageIdList {
  readonly total: number;
  readonly ids: readonly string[];
}

/**
 * نتيجة التغطية الخالية من الحمولات والمبالغ والأسماء، مع حالة الاعتماد وسقف القوائم.
 * COVERED تثبت النطاق المطبوع في `tipScope` فقط؛ نطاق جزئي من أنشطة الشركة أو أيامها ليس إثباتاً لها كلها.
 */
export interface CommissionCoverageReport {
  /** COVERED فقط حين فُحصت الأقسام الأربعة وسلمت كل الفحوص؛ أي نتيجة غيرها تنهي التشغيل بخروج غير صفري. */
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
  /** الأنشطة والتاريخان اللذان فُحص بهما البقشيش، أو null حين لم يُفحص. */
  readonly tipScope: CommissionCoverageTipScope | null;
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
  /** انتماء أنشطة نطاق البقشيش للشركة قبل أي مسح. */
  readonly businesses: CoverageBusinessReader;
  readonly consumerId: string;
  /** أنواع الأحداث التي يسجّلها المستهلك؛ الحدث من نوع آخر لا يُفحص في العلامات ولا يُسلّم. */
  readonly handledTypes: ReadonlySet<string>;
  /** قارئ الزيارات التي لها بقشيش؛ لازم لفحص البقشيش بالمراجعة. */
  readonly tipsReader?: CurrentTipSessionsReader;
}

interface CheckContext {
  readonly deps: CommissionCoverageDeps;
  readonly companyId: string;
}

/**
 * تحسب حالة الاعتماد. كل الفحوص السابقة باقية: قسم ناقص أو متأخر، وحدث محتفظ به بلا علامة المستهلك،
 * ونوع غير مسجَّل. ويُضاف إليها أن البقشيش فُحص فعلاً؛ بقشيش غير مفحوص (null) لا يكفي للتغطية.
 */
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
    tips !== null &&
    tips.missing.total === 0 &&
    tips.stale.total === 0
  );
}

/**
 * رمز خروج التشغيل: صفر للتغطية الكاملة فقط، وواحد لأي نتيجة أخرى بما فيها بقشيش لم يُفحص.
 *
 * @param report نتيجة التقرير بعد تشغيله
 * @returns 0 حين تكون الحالة COVERED وإلا 1
 */
export function commissionCoverageExitCode(report: Pick<CommissionCoverageReport, 'status'>): 0 | 1 {
  return report.status === 'COVERED' ? 0 : 1;
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
 * @param deps قارئات المصدر والإسقاط والأحداث المحتفظ بها وقارئا الشركة والنشاط ومعرّف المستهلك وأنواعه
 * @param scope الشركة والحد الأعلى الاختياري لفحص الأحداث المحتفظ بها ونطاق البقشيش
 * @returns حالة التغطية والأعداد والهويات الناقصة أو المتأخرة أو غير المستهلكة، ونطاق البقشيش المفحوص
 * @throws CommissionCoverageScopeInvalidError لنطاق بقشيش غير صالح أو فارغ أو نشاط ليس من الشركة، قبل أي مسح
 */
export async function runCommissionCoverageReport(
  deps: CommissionCoverageDeps,
  scope: CommissionCoverageScope,
): Promise<CommissionCoverageReport> {
  const tipScope = normalizeTipScope(scope.tips);
  const companyId = scope.companyId.toLowerCase();
  await assertCoverageScope(deps, companyId, tipScope);
  const context: CheckContext = { deps, companyId };
  const lineTotals = await checkLines(context);
  const salaryTotals = await checkSalaries(context);
  const saleTotals = await checkSales(context);
  const unmarked = await checkUnmarked(context, scope.throughId);
  assertStableThroughId(unmarked.lastEventId, scope.throughId);
  const tips = await checkTips(context, tipScope);
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
    tips: tips === null ? null : { checked: tips.checked, missing: tips.missing, stale: tips.stale },
    tipsNote: tips === null ? TIPS_NOT_CHECKED_NOTE : null,
    tipScope: tipScope ?? null,
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

/** يفحص البقشيش بالمراجعة إذا طلب المشغّل نطاقاً؛ بدونه لا فحص، والتقرير يقول ذلك ولا يعدّه تغطية. */
async function checkTips(
  context: CheckContext,
  tipScope: CommissionCoverageTipScope | undefined,
): Promise<TipCoverageResult | null> {
  if (tipScope === undefined) return null;
  const tipsReader = context.deps.tipsReader;
  if (tipsReader === undefined) throw new CommissionCoverageScopeInvalidError();
  return checkTipCoverage({
    withTenant: context.deps.withTenant,
    projection: context.deps.projection,
    tipsReader,
    companyId: context.companyId,
    scope: tipScope,
  });
}

function coverageResult(totals: CoverageTotals): CommissionCoverageReport['lines'] {
  return {
    checked: totals.checked,
    missing: { total: totals.missing.total, ids: totals.missing.items },
    stale: { total: totals.stale.total, ids: totals.stale.items },
  };
}
