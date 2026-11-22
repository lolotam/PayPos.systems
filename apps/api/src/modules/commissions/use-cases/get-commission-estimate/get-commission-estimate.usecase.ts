import { projectCommissionEstimate } from '@pospay/commissions-engine';
import type { CommissionEstimate } from '@pospay/contracts';

import type { CommissionEstimateReader } from '../../ports/commission-estimate.port.ts';
import { estimateContract } from './estimate-mapping.ts';

export type { CommissionEstimateReader };

/** طلب التقدير: النشاط والشهر والموظفة المطلوبة اختيارياً. */
export interface CommissionEstimateRequest {
  /** الشركة المؤكدة من الجلسة، مش من العميل. */
  readonly companyId: string;
  /** المستخدم البشري الفاعل، من الجلسة. */
  readonly userId: string;
  readonly businessId: string;
  readonly period: string;
  readonly employeeId: string | null;
}

/** أسباب رفض التقدير: الرفض الموحّد والميزة المقفولة، وبيترجموا لخطأ API معروف. */
export type CommissionEstimateErrorCode = 'FORBIDDEN' | 'FEATURE_DISABLED';

/** رفض التقدير بكود مستقل عن HTTP، وتفاصيل كود المحرك عند الحاجة. */
export class CommissionEstimateError extends Error {
  readonly code: CommissionEstimateErrorCode;

  /**
   * يحتفظ بكود الرفض حتى تترجمه طبقة HTTP دون أن يعرف الـ domain بها.
   *
   * @param code كود رفض التقدير
   */
  constructor(code: CommissionEstimateErrorCode) {
    super(code);
    this.name = 'CommissionEstimateError';
    this.code = code;
  }
}

/**
 * يقدّر عمولة موظفة لشهر واحد من الوضع الحالي، من غير تخزين ولا قفل ولا أثر
 * (FR-021). التسعير بيحصل مرة واحدة لكل موظفة على الشهر كله، والفلترة بنطاق
 * الفروع بتحصل بعد التسعير عشان مواضع الشرائح ما تتقادش لكل فرع.
 */
export class GetCommissionEstimateUseCase {
  constructor(private readonly reader: CommissionEstimateReader) {}

  /**
   * @param request النشاط والشهر والموظفة المطلوبة اختيارياً
   * @returns تقدير الشهر بالموظفات المرئيات
   */
  async execute(request: CommissionEstimateRequest): Promise<CommissionEstimate> {
    const read = await this.reader.read({
      companyId: request.companyId,
      userId: request.userId,
      businessId: request.businessId,
      period: request.period,
      employeeId: request.employeeId,
    });
    if (read.kind === 'forbidden') throw new CommissionEstimateError('FORBIDDEN');
    if (read.kind === 'feature_disabled') throw new CommissionEstimateError('FEATURE_DISABLED');
    const inputs = read.inputs;
    const projection = projectCommissionEstimate({
      scope: { businessWide: inputs.businessWide, branchIds: inputs.branchIds },
      period: request.period,
      employeeIds: inputs.employees.map((employee) => employee.employeeId),
      month: inputs.month,
      attachments: inputs.attachments,
    });
    return estimateContract(
      request.businessId,
      request.period,
      projection,
      new Map(inputs.employees.map((employee) => [employee.employeeId, employee])),
      inputs.serviceNames,
    );
  }
}
