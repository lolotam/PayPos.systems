import type { CommissionEstimate } from '@pospay/contracts';

import type { CommissionEstimateReader } from '../../ports/commission-estimate.port.ts';
import {
  buildCommissionEstimate,
  type CommissionEstimateRequest,
} from './estimate-assembly.ts';

export type { CommissionEstimateReader };

/** أسباب رفض التقدير: الرفض الموحّد والميزة المقفولة، وبيترجموا لخطأ API معروف. */
export type CommissionEstimateErrorCode = 'FORBIDDEN' | 'FEATURE_DISABLED' | 'VALIDATION_FAILED';

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
    });
    if (read.kind === 'forbidden') throw new CommissionEstimateError('FORBIDDEN');
    if (read.kind === 'feature_disabled') throw new CommissionEstimateError('FEATURE_DISABLED');
    return buildCommissionEstimate(read.inputs, request);
  }
}
