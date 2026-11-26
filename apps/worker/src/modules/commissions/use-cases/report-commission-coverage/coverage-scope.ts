import { isCommissionCalendarDate } from '../../domain/commission-calendar.ts';
import type {
  CoverageBusinessReader,
  CoverageCompanyReader,
  CoverageTenantRunner,
} from '../../ports/commission-coverage.port.ts';

// القاعدة نفسها في domain/، وده تصدير اسمي لها: use-cases/ ما بتاخدش نسخة من القاعدة.
export { isCommissionCalendarDate as isCommissionCoverageCalendarDate } from '../../domain/commission-calendar.ts';

/** نطاق البقشيش كما طلبه المشغّل: أنشطة الشركة ويوما بداية العمل ونهايته. */
export interface CommissionCoverageTipScope {
  readonly businessIds: readonly string[];
  readonly from: string;
  readonly to: string;
}

/** نطاق لا يمكن التقرير عنه: شركة غير موجودة، نشاط ليس لها، نطاق بقشيش مرفوض أو حد أعلى ليس حدثاً محتفظاً بها. */
export class CommissionCoverageScopeInvalidError extends Error {
  readonly code = 'COMMISSION_COVERAGE_SCOPE_INVALID';

  constructor() {
    super('COMMISSION_COVERAGE_SCOPE_INVALID');
    this.name = 'CommissionCoverageScopeInvalidError';
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * يطبّع نطاق البقشيش قبل أي قراءة: تواريخ تقويمية حقيقية و`from` ليس بعد `to`،
 * وقائمة أنشطة غير فارغة بمعرّفات UUID صغيرة بلا تكرار.
 * قائمة فارغة كانت تُنفّذ صفر قراءات فتُقرأ نتيجتها كتغطية، ولا يوجد افتراض «كل الأنشطة».
 *
 * @param tips نطاق البقشيش المطلوب أو undefined حين لم يطلبه المشغّل
 * @returns النطاق المطبّع، أو undefined حين لا نطاق بقشيش
 * @throws CommissionCoverageScopeInvalidError عند أي تاريخ أو قائمة أنشطة غير صالحة
 */
export function normalizeTipScope(
  tips: CommissionCoverageTipScope | undefined,
): CommissionCoverageTipScope | undefined {
  if (tips === undefined) return undefined;
  const datesValid =
    isCommissionCalendarDate(tips.from) &&
    isCommissionCalendarDate(tips.to) &&
    tips.from <= tips.to;
  const businessIds = [...new Set(tips.businessIds.map((id) => id.trim().toLowerCase()))];
  if (!datesValid || businessIds.length === 0 || !businessIds.every((id) => UUID.test(id)))
    throw new CommissionCoverageScopeInvalidError();
  return { businessIds, from: tips.from, to: tips.to };
}

/** القارئات التي يحتاجها فحص النطاق على معاملة الشركة. */
interface ScopeCheckDeps {
  readonly withTenant: CoverageTenantRunner;
  readonly companies: CoverageCompanyReader;
  readonly businesses: CoverageBusinessReader;
}

/**
 * يثبت أن الشركة موجودة وأن كل نشاط في نطاق البقشيش من أنشطتها، قبل أي مسح.
 * نشاط شركة أخرى لا يُقرأ منه شيء تحت RLS فكان التقرير يطبع COVERED عن نطاق فارغ.
 *
 * @param deps معاملة الشركة وقارئا وجود الشركة والنشاط
 * @param companyId الشركة المفحوصة بحروف صغيرة
 * @param tips نطاق البقشيش المطبّع أو undefined
 * @throws CommissionCoverageScopeInvalidError لشركة غير موجودة أو نشاط ليس من أنشطتها
 */
export async function assertCoverageScope(
  deps: ScopeCheckDeps,
  companyId: string,
  tips: CommissionCoverageTipScope | undefined,
): Promise<void> {
  const inScope = await deps.withTenant(companyId, async (tx) => {
    if (!(await deps.companies.isOpen(tx, companyId))) return false;
    for (const businessId of tips?.businessIds ?? []) {
      if (!(await deps.businesses.isInCompany(tx, companyId, businessId))) return false;
    }
    return true;
  });
  if (!inScope) throw new CommissionCoverageScopeInvalidError();
}
