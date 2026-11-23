import type {
  CommissionEstimateEmployeeProjection,
  CommissionEstimateProjection,
} from '@pospay/commissions-engine';
import type {
  CommissionEstimate,
  CommissionEstimateEmployee,
  CommissionEstimateSale,
  CommissionEstimateSource,
} from '@pospay/contracts';
import { moneyToString } from '@pospay/domain';

import type { CommissionEstimateEmployeeName } from '../../ports/commission-estimate.port.ts';

/** أسماء الخدمات كما يقراها الكتالوج، وبتتحول لاسم العرض في المصدر. */
type ServiceNames = ReadonlyMap<string, { readonly nameEn: string; readonly nameAr: string | null }>;

/**
 * يحوّل إسقاط المحرّك لسكيما الرد: الأرقام بتبقى نصوص بثلاث منازل والمجموع
 * المجهول بيفضل null. التحويل شكل بحت: كل المبلغ جاي من الإسقاط ومفيش جمع ولا
 * تقريب هنا.
 *
 * @param businessId النشاط المطلوب
 * @param period الشهر المطلوب بصيغة YYYY-MM
 * @param projection إسقاط المحرّك لكل الموظفات المرئيات
 * @param names أسماء الموظفات من قارئ الموظفين
 * @param serviceNames أسماء الخدمات من الكتالوج
 * @returns رد التقدير
 */
export function estimateContract(
  businessId: string,
  period: string,
  projection: CommissionEstimateProjection,
  names: ReadonlyMap<string, CommissionEstimateEmployeeName>,
  serviceNames: ServiceNames,
): CommissionEstimate {
  const employees: CommissionEstimateEmployee[] = [];
  for (const employee of projection.employees) {
    const row = estimateEmployee(employee, names, serviceNames);
    if (row !== null) employees.push(row);
  }
  return {
    business_id: businessId,
    period,
    employees,
    partial: projection.partial,
    total: projection.total === null ? null : moneyToString(projection.total),
  };
}

/**
 * صف الموظفة في الرد. الاسم من قارئ الموظفين (D-16)، والمحرّك بيسقط الموظفات
 * اللي عندهن صف في ذلك القارئ بس، فالسطر اللي مالوش اسم مستحيل.
 *
 * @param projection إسقاط الموظفة
 * @param names أسماء الموظفات من قارئ الموظفين
 * @param serviceNames أسماء الخدمات من الكتالوج
 * @returns صف الموظفة أو null لما الاسم مش موجود
 */
function estimateEmployee(
  projection: CommissionEstimateEmployeeProjection,
  names: ReadonlyMap<string, CommissionEstimateEmployeeName>,
  serviceNames: ServiceNames,
): CommissionEstimateEmployee | null {
  const name = names.get(projection.employeeId);
  if (name === undefined) return null;
  const sources: CommissionEstimateSource[] = projection.sources.map((source) => ({
    source_ref: source.sourceRef,
    kind: source.kind,
    amount: moneyToString(source.amount),
    source_branch_id: source.branchId,
    source_business_date: source.businessDate,
    service_id: source.serviceId,
    service_name: source.serviceId === null ? null : (serviceNames.get(source.serviceId)?.nameEn ?? null),
  }));
  const sales: CommissionEstimateSale[] = projection.sales.map((sale) => ({
    sale_id: sale.saleId,
    amount: moneyToString(sale.amount),
    source_branch_id: sale.branchId,
    source_business_date: sale.businessDate,
  }));
  return {
    employee_id: projection.employeeId,
    name_ar: name.nameAr,
    name_en: name.nameEn,
    employee_number: name.employeeNumber,
    status: projection.status,
    partial: projection.partial,
    total: projection.total === null ? null : moneyToString(projection.total),
    sources,
    sales,
    tips: { card: moneyToString(projection.tips.card), cash: moneyToString(projection.tips.cash) },
    corrections: projection.corrections.map((correction) => ({
      source_ref: correction.sourceRef,
      kind: correction.kind,
      amount: moneyToString(correction.amount),
      source_branch_id: correction.sourceBranchId,
      source_business_date: correction.sourceBusinessDate,
    })),
    carries: {
      commission: moneyToString(projection.carries.commission),
      tip_card: moneyToString(projection.carries.tipCard),
    },
  };
}
