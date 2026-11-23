import type { TenantWrappers, Tx } from '@pospay/db';

import type { CommissionEstimateMonthRows } from '@pospay/commissions-engine';

import type { CommissionEstimateReader } from '../ports/commission-estimate.port.ts';
import type { CommissionEstimateProviders } from './commission-estimate-providers.ts';
import { readEstimateMonth } from './commission-estimate-readers.ts';

/** طلب القراءة: الشركة والمستخدم والنشاط والشهر والموظفة المطلوبة اختيارياً. */
interface EstimateReadRequest {
  readonly companyId: string;
  readonly userId: string;
  readonly businessId: string;
  readonly period: string;
  readonly employeeId: string | null;
}

/**
 * مصنع قارئ التقدير: بيفتح معاملة قراءة فقط ويقرا كل المدخلات في لقطة واحدة
 * (D-25). المعاملة READ ONLY فمفيش طريق يكتب من غير ما السطر يبان في الكود،
 * واللقطة الواحدة بتخلي التسعير والفلترة على نفس البيانات.
 *
 * @param database واجهات الداتابيز اللي بتفتح معاملة المستأجر
 * @param providers مزودو النطاق والاسم والارتباطات المربوطين في جذر التطبيق
 * @returns قارئ التقدير
 */
export function createCommissionEstimateReader(
  database: TenantWrappers,
  providers: CommissionEstimateProviders,
): CommissionEstimateReader {
  return {
    read: async (input) =>
      // معاملة واحدة: إثبات العضوية تحت سياق المستخدم، ثم تفعيل سياق الشركة، وكل
      // القراءات بتشارك لقطة القراءة (ADR-0003 §4). معاملة من غير عضوية سارية
      // بترجع null، وده رفض موحّد.
      (await database.withMember(
        input.userId,
        input.companyId,
        (tx) => readEstimateInputs(tx, input, providers),
        { readOnly: true },
      )) ?? { kind: 'forbidden' },
  };
}

/** بيفحص النطاق والميزة ويقرا مدخلات التقدير كلها من معاملة القراءة الواحدة. */
async function readEstimateInputs(
  tx: Tx,
  request: EstimateReadRequest,
  providers: CommissionEstimateProviders,
): ReturnType<CommissionEstimateReader['read']> {
  const scope = await providers.scope(tx, request.companyId, request.userId, request.businessId);
  if (scope.kind === 'forbidden') return { kind: 'forbidden' };
  if (scope.kind === 'feature_disabled') return { kind: 'feature_disabled' };
  if (!(await providers.featureEnabled(tx, request.companyId))) return { kind: 'feature_disabled' };
  const employees = await providers.employees(
    tx,
    request.companyId,
    request.businessId,
    request.employeeId,
  );
  const month = await readEstimateMonth(
    tx,
    request.companyId,
    request.businessId,
    request.period,
    request.employeeId,
  );
  const attachments = await providers.attachments(
    tx,
    request.companyId,
    request.businessId,
    candidateIds(employees, month),
    request.period,
  );
  const serviceNames = await providers.serviceNames(
    tx,
    request.companyId,
    request.businessId,
    [...new Set(month.lines.map((line) => line.serviceId))],
  );
  return {
    kind: 'ok',
    inputs: {
      businessWide: scope.businessWide,
      branchIds: scope.branchIds,
      employees,
      attachments,
      month,
      serviceNames,
    },
  };
}

/** الموظفات اللي ممكن يكون ليهن مدخل في الشهر: مرشحات التقدير كلهن. */
function candidateIds(
  employees: readonly { readonly employeeId: string }[],
  month: CommissionEstimateMonthRows,
): readonly string[] {
  const ids = new Set(employees.map((employee) => employee.employeeId));
  for (const line of month.lines) ids.add(line.employeeId);
  for (const sale of month.sales) if (sale.sellerEmployeeId !== null) ids.add(sale.sellerEmployeeId);
  for (const tip of month.tips) ids.add(tip.employeeId);
  for (const correction of month.corrections) ids.add(correction.employeeId);
  for (const carry of month.carries ?? []) ids.add(carry.employeeId);
  return [...ids];
}
