import {
  addComparison,
  compareCoverage,
  emptyCoverageTotals,
} from '@pospay/commissions-engine';

import type {
  CoverageProjectionReader,
  CoverageTenantRunner,
  PackageSaleCoverageReader,
} from '../../ports/commission-coverage.port.ts';
import { REPORT_LIST_LIMIT } from './check-retained-events.ts';

const SALE_PAGE_SIZE = 200;

/** تبعيات فحص تغطية البيع: معاملة الشركة والقارئ والإسقاط. */
interface SaleCoverageDeps {
  readonly withTenant: CoverageTenantRunner;
  readonly sales: PackageSaleCoverageReader;
  readonly projection: CoverageProjectionReader;
  readonly companyId: string;
}

/** نتيجة تغطية البيع: عدد المفحوص وقائمتان محدودتان وراية الاقتطاع. */
export interface SaleCoverageResult {
  readonly checked: number;
  readonly missing: { readonly total: number; readonly ids: readonly string[] };
  readonly stale: { readonly total: number; readonly ids: readonly string[] };
  readonly truncated: boolean;
}

/**
 * يقارن مراجعة كل باكدج مُباع في المصدر بمراجعته في الإسقاط (CM-20b).
 * البيع الغائب من الإسقاط ناقص، والمراجعة الأقدم من المصدر متأخرة، والمساوية أو الأحدث مغطاة.
 * المستورَد ما ليهش بيع ولا حدث، فالقارئ ما بيرجّعه أصلاً وما بيدخلش الفحص.
 * كل صفحة تُقرأ في معاملة قراءة مستقلة على مفتاح المصدر الأساسي.
 *
 * @param deps معاملة الشركة وقارئ المبيعات والإسقاط
 * @returns عدد البيعات المفحوصة وقائمتا البيعات الناقصة والمتأخرة
 */
export async function checkSaleCoverage(deps: SaleCoverageDeps): Promise<SaleCoverageResult> {
  let totals = emptyCoverageTotals();
  let after: string | null = null;
  for (;;) {
    const result = await deps.withTenant(deps.companyId, async (tx) => {
      const page = await deps.sales.readPage(tx, deps.companyId, after, SALE_PAGE_SIZE);
      const projected = await deps.projection.saleRevisions(
        tx,
        deps.companyId,
        page.rows.map((row) => row.saleId),
      );
      return {
        nextAfter: page.nextAfter,
        comparison: compareCoverage(
          page.rows.map((row) => ({ key: row.saleId, revision: row.revision })),
          projected.map((row) => ({ key: row.saleId, revision: row.revision })),
        ),
      };
    });
    totals = addComparison(totals, result.comparison, REPORT_LIST_LIMIT);
    after = result.nextAfter;
    if (after === null) {
      return {
        checked: totals.checked,
        missing: { total: totals.missing.total, ids: totals.missing.items },
        stale: { total: totals.stale.total, ids: totals.stale.items },
        truncated: totals.missing.truncated || totals.stale.truncated,
      };
    }
  }
}
