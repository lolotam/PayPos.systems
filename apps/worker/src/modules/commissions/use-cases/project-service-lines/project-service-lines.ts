import { allocateLineShares } from '@pospay/commissions-engine';
import type {
  ServiceLineChanged,
  ServiceSessionLinesAdded,
  ServiceSessionRecorded,
} from '@pospay/contracts';
import { moneyToString, parseMoney } from '@pospay/domain';

import {
  affectedCommissionPeriods,
  commissionRuleColumns,
  periodOfBusinessDate,
  selectNewerCommissionLines,
  validateCommissionLineEvent,
} from '../../domain/commission-lines.ts';
import {
  classifyCommissionPeriods,
  commissionPeriodLockPlan,
  currentBusinessPeriod,
} from '../../domain/commission-periods.ts';
import type {
  CommissionLineEventInput,
  CommissionLineSnapshot,
} from '../../domain/commission-line-types.ts';
import {
  CommissionBusinessMissingError,
  CommissionLineEventInvalidError,
  CommissionPeriodClosedError,
} from '../../domain/errors.ts';
import type {
  Clock,
  CommissionInputEventEnvelope,
  CommissionLinePerformerWrite,
  CommissionLineProjectionScope,
  CommissionLineReplacement,
  IdGenerator,
} from '../../ports/commission-line-projection.port.ts';

type CommissionInputEventPayload =
  | ServiceSessionRecorded
  | ServiceSessionLinesAdded
  | ServiceLineChanged;

export { CommissionLineEventInvalidError } from '../../domain/errors.ts';

/** يطبّق أحدث لقطات بنود الخدمة على إسقاط العمولة ويفتح مراجعة الشهر المتأثر عند الحاجة. */
export class ProjectServiceLines {
  constructor(
    private readonly scope: CommissionLineProjectionScope,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
  ) {}

  async execute(input: CommissionLineEventInput): Promise<void> {
    validateCommissionLineEvent(input);
    const lineIds = [...new Set(input.lines.map((line) => line.lineId))].sort();
    await this.scope.lockLines(lineIds);
    const heads = await this.scope.readHeads(lineIds);
    const newer = selectNewerCommissionLines(input.lines, heads);
    if (newer.length === 0) return;
    const affected = affectedCommissionPeriods(newer, heads);
    const timeZone = await this.scope.businessTimeZone(input.companyId, input.businessId);
    if (timeZone === null) throw new CommissionBusinessMissingError(input.businessId);
    const currentPeriod = currentBusinessPeriod(this.clock.now(), timeZone);
    const plan = commissionPeriodLockPlan(affected, currentPeriod);
    const locked = await this.scope.lockPeriods({
      businessId: input.businessId,
      periods: plan.periodsToLock,
      ids: this.ids,
    });
    const { closed, reviewed } = classifyCommissionPeriods(locked, plan.affectedPeriods);
    if (closed.length > 0) throw new CommissionPeriodClosedError(closed);
    await this.scope.replaceLines(newer.map(projectLine));
    await this.scope.reopenReviewed({ businessId: input.businessId, periods: reviewed });
  }
}

export function normalizeCommissionLineEvent(
  event: CommissionInputEventEnvelope,
  payload: CommissionInputEventPayload,
): CommissionLineEventInput {
  if (event.aggregateType !== 'service_session' || event.aggregateId !== payload.session_id) {
    throw new CommissionLineEventInvalidError('AGGREGATE_MISMATCH');
  }
  const lines: readonly ServiceLineChanged[] = 'lines' in payload ? payload.lines : [payload];
  return {
    companyId: event.companyId,
    businessId: payload.business_id,
    sessionId: payload.session_id,
    lines: lines.map(normalizeCommissionLine),
  };
}

function normalizeCommissionLine(line: ServiceLineChanged): CommissionLineSnapshot {
  return {
    lineId: line.line_id,
    sessionId: line.session_id,
    businessId: line.business_id,
    branchId: line.branch_id,
    serviceId: line.service_id,
    customerId: line.customer_id,
    status: line.status,
    occurredAt: line.occurred_at,
    recordedAt: line.recorded_at,
    businessDate: line.business_date,
    net: line.net,
    performers: line.performers.map((performer) => ({
      employeeId: performer.employee_id,
      shareBps: performer.share_bps,
    })),
    ruleSnapshot: line.rule_snapshot,
    countsSnapshot: line.counts_snapshot,
    revision: line.revision,
  };
}

function projectLine(line: CommissionLineSnapshot): CommissionLineReplacement {
  const period = periodOfBusinessDate(line.businessDate);
  const net = parseMoney(line.net);
  const shares = allocateLineShares(
    net,
    line.performers.map((performer) => ({
      employeeId: performer.employeeId,
      shareBps: BigInt(performer.shareBps),
    })),
  );
  const rule = commissionRuleColumns(line.ruleSnapshot);
  // ترتيب المنفّذين بهويتهم هو ترتيب ناتج التوزيع نفسه، عشان يبقى ترتيب الصفوف ثابتاً.
  const performers = [...line.performers].sort((a, b) =>
    a.employeeId < b.employeeId ? -1 : a.employeeId > b.employeeId ? 1 : 0,
  );
  const rows: CommissionLinePerformerWrite[] = performers.map((performer) => {
    const netShare = shares.get(performer.employeeId);
    if (netShare === undefined) {
      // التوزيع مبني على المنفّذين نفسهم، فغياب نصيب هنا كسر داخلي لا خطأ في الحدث.
      throw new CommissionLineEventInvalidError('PERFORMER_SHARE_MISSING', line.lineId);
    }
    return {
      businessId: line.businessId,
      lineId: line.lineId,
      branchId: line.branchId,
      employeeId: performer.employeeId,
      serviceId: line.serviceId,
      occurredAt: line.occurredAt,
      recordedAt: line.recordedAt,
      businessDate: line.businessDate,
      period,
      net: moneyToString(net),
      netShare: moneyToString(netShare),
      shareBps: performer.shareBps,
      ...rule,
      counts: line.countsSnapshot,
      status: line.status,
    };
  });
  return {
    head: {
      businessId: line.businessId,
      lineId: line.lineId,
      sessionId: line.sessionId,
      branchId: line.branchId,
      serviceId: line.serviceId,
      customerId: line.customerId,
      revision: line.revision,
      status: line.status,
      businessDate: line.businessDate,
      period,
    },
    rows,
  };
}
