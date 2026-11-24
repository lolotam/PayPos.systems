import type {
  CommissionClosedStatementBranchView,
  CommissionClosedStatementView,
  CommissionStatementBranchView,
  CommissionStatementView,
} from '@pospay/contracts';

import { CommissionPlanVersionError } from '../../domain/errors.ts';
import type { CommissionStatementReader } from '../../ports/commission-statement.port.ts';
import type { FingerprintHasher } from '../../ports/fingerprint-hasher.port.ts';
import { closedStatementView } from '../compute-statement-view/closed-statement-view.ts';
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
 * يعرض كشف الشهر من غير ما يكتب أي حاجة ولا يقفل ولا ينشئ صف (FR-025، D-25): بيقرا المصادر في
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
  ): Promise<
    | CommissionStatementView
    | CommissionStatementBranchView
    | CommissionClosedStatementView
    | CommissionClosedStatementBranchView
  > {
    const result = await this.reader.read(request);
    if (result.kind === 'forbidden') throw new CommissionPlanVersionError('FORBIDDEN');
    if (result.kind === 'feature_disabled') throw new CommissionPlanVersionError('FEATURE_DISABLED');
    const { source, businessWide, branchIds, closed } = result.read;
    const status = source.statement?.status;
    // شهر اتجمّد بيتعرض من صفوفه المجمّدة وحدها، من غير أي حساب حي (FR-025، FR-033).
    if (status === 'APPROVED' || status === 'PAID') {
      if (closed === null) throw new Error('A closed statement was read without its frozen rows');
      return closedStatementView({
        businessId: request.businessId,
        period: request.period,
        status,
        ...closed,
        scope: { businessWide, branchIds },
      });
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
