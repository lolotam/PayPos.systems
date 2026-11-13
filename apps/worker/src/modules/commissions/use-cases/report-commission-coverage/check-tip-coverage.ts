import {
  addComparison,
  compareCoverage,
  emptyCoverageTotals,
  type CoverageTotals,
} from '@pospay/commissions-engine';

import type {
  CoverageProjectionReader,
  CoverageTenantRunner,
} from '../../ports/commission-coverage.port.ts';
import type { CurrentTipSessionsReader } from '../../ports/commission-tip-bootstrap.port.ts';
import { REPORT_LIST_LIMIT } from './check-retained-events.ts';

const TIP_PAGE_SIZE = 100;

/** نطاق تغطية البقشيش بالمراجعة: أنشطة المشغّل ونطاق يومي العمل. */
export interface TipCoverageScope {
  readonly businessIds: readonly string[];
  readonly from: string;
  readonly to: string;
}

/** نتيجة تغطية البقشيش: عدد المفحوص وقائمتان محدودتان وراية الاقتطاع. */
export interface TipCoverageResult {
  readonly checked: number;
  readonly missing: { readonly total: number; readonly ids: readonly string[] };
  readonly stale: { readonly total: number; readonly ids: readonly string[] };
  readonly truncated: boolean;
}

/** تبعيات فحص البقشيش: معاملة الشركة والإسقاط وقارئ الزيارات. */
interface TipCoverageDeps {
  readonly withTenant: CoverageTenantRunner;
  readonly projection: CoverageProjectionReader;
  readonly tipsReader: CurrentTipSessionsReader;
  readonly companyId: string;
  readonly scope: TipCoverageScope;
}

/**
 * يقارن مراجعة البقشيش في المصدر بمراجعتها في الإسقاط لكل نشاط في النطاق.
 * الجلسة الغائبة من الإسقاط ناقصة، والمراجعة الأقدم منها متأخرة، والمراجعة الأحدث أو المساوية مغطاة.
 * كل صفحة تُقرأ في معاملة قراءة مستقلة، والأنشطة بحروف صغيرة بلا تكرار وبالترتيب المُعطى.
 *
 * @param deps معاملة الشركة والإسقاط وقارئ الزيارات والنطاق المطلوب فحصه
 * @returns عدد الزيارات المفحوصة وقائمتا الجلسات الناقصة والمتأخرة
 */
export async function checkTipCoverage(deps: TipCoverageDeps): Promise<TipCoverageResult> {
  let totals = emptyCoverageTotals();
  for (const businessId of businessIds(deps.scope.businessIds)) {
    totals = await checkBusiness(deps, businessId, totals);
  }
  return {
    checked: totals.checked,
    missing: { total: totals.missing.total, ids: totals.missing.items },
    stale: { total: totals.stale.total, ids: totals.stale.items },
    truncated: totals.missing.truncated || totals.stale.truncated,
  };
}

/** الأنشطة بحروف صغيرة بلا تكرار وبالترتيب المُعطى. */
function businessIds(ids: readonly string[]): readonly string[] {
  return [...new Set(ids.map((id) => id.trim().toLowerCase()))];
}

/** يمرّ على صفحات نشاط واحد ويقارن كل صفحة بالأسقاط قبل الصفحة التالية. */
async function checkBusiness(
  deps: TipCoverageDeps,
  businessId: string,
  totals: CoverageTotals,
): Promise<CoverageTotals> {
  let after: { readonly businessDate: string; readonly sessionId: string } | null = null;
  for (;;) {
    const result = await deps.withTenant(deps.companyId, async (tx) => {
      const page = await deps.tipsReader.readPage(
        tx,
        deps.companyId,
        businessId,
        { from: deps.scope.from, to: deps.scope.to },
        { after, limit: TIP_PAGE_SIZE },
      );
      const projected = await deps.projection.tipRevisions(
        tx,
        deps.companyId,
        page.items.map((item) => item.sessionId),
      );
      return {
        next: page.nextCursor,
        comparison: compareCoverage(
          page.items.map((item) => ({ key: item.sessionId, revision: item.revision })),
          projected.map((row) => ({ key: row.sessionId, revision: row.revision })),
        ),
      };
    });
    totals = addComparison(totals, result.comparison, REPORT_LIST_LIMIT);
    after = result.next;
    if (after === null) return totals;
  }
}
