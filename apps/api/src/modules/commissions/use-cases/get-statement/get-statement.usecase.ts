import type { CommissionStatementBranchView, CommissionStatementView } from '@pospay/contracts';

import { CommissionPlanVersionError } from '../../domain/errors.ts';
import type { CommissionStatementReader } from '../../ports/commission-statement.port.ts';
import type { FingerprintHasher } from '../../ports/fingerprint-hasher.port.ts';
import { computeStatement } from '../compute-statement-view/compute-statement-view.ts';
import {
  branchViewContract,
  businessViewContract,
} from '../compute-statement-view/statement-view-contract.ts';

/** طلب عرض الكشف: النشاط والشهر، والشركة والمستخدم من الجلسة. */
export interface GetCommissionStatementRequest {
  readonly companyId: string;
  readonly userId: string;
  readonly businessId: string;
  readonly period: string;
}

/**
 * يعرض كشف شهر مفتوح من غير ما يكتب أي حاجة ولا يقفل ولا ينشئ صف (FR-025، D-25): بيقرا المصادر في
 * معاملة READ ONLY من خلال البورت وحده، ويحسب الكشف وبصمتيه، ويختار شكل الرد بنفس الشرط اللي بيحدد قارئ
 * النشاط كله (CM-28c).
 */
export class GetCommissionStatementUseCase {
  constructor(
    private readonly reader: CommissionStatementReader,
    private readonly hasher: FingerprintHasher,
  ) {}

  /**
   * @param request النشاط والشهر والفاعل
   * @returns كشف الشهر بشكل قارئ النشاط كله أو قارئ الفروع
   */
  async execute(
    request: GetCommissionStatementRequest,
  ): Promise<CommissionStatementView | CommissionStatementBranchView> {
    const result = await this.reader.read(request);
    if (result.kind === 'forbidden') throw new CommissionPlanVersionError('FORBIDDEN');
    if (result.kind === 'feature_disabled') throw new CommissionPlanVersionError('FEATURE_DISABLED');
    const { source, businessWide, branchIds } = result.read;
    const status = source.statement?.status;
    // TODO(spec): قراءة الكشف المغلق من صفوفه المجمّدة بتتكتب مع 53-2 اللي بتكتب الصفوف دي؛ لحد وقتها الشهر
    // المغلق بيترفض بنفس رفض الكاتبين بدل ما نعرض حساب حي لشهر اتجمّد.
    if (status === 'APPROVED' || status === 'PAID') {
      throw new CommissionPlanVersionError('COMMISSION_PERIOD_CLOSED');
    }
    const context = {
      businessId: request.businessId,
      period: request.period,
      source,
      computed: computeStatement(request.period, source, this.hasher),
      scope: { businessWide, branchIds },
    };
    return businessWide ? businessViewContract(context) : branchViewContract(context);
  }
}
