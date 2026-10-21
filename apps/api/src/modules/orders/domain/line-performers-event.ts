import { moneyToString } from '@pospay/domain';
import { sessionRuleSnapshot } from './session-snapshot.ts';
import type { SessionLine, SessionRecord } from './session-types.ts';

/** القيم السابقة التي يعلنها حدث تغيير المنفّذين؛ النسخة الجديدة هي السابقة زائد واحد. */
export interface LinePerformersEventPrevious {
  revision: number;
  performers: readonly { employee_id: string; share_bps: number }[];
}

/** مدخل حدث تغيير منفّذات سطر واحد بعد الحفظ؛ المسجّلة الأصلية تبقى كما هي. */
export interface LinePerformersEventInput {
  record: SessionRecord;
  line: SessionLine;
  previous: LinePerformersEventPrevious;
  changer: { userId: string; membershipId: string; at: Date };
}

/**
 * يبني حدث تغيير منفّذات سطر واحد بلا سبب وبلا أسماء، والنسخة هي السابقة زائد واحد.
 * السطر يبقى ACTIVE لأن تغيير المنفّذين لا يلغي البند، والمال يخرج بنص من ثلاث خانات.
 * ترتيب المنفّذات هو الترتيب المحفوظ: من يقرأ صفوف التاريخ يقارن بالمواضع لا بالمعرّفات.
 *
 * @param input الزيارة والسطر المحفوظ والقيم السابقة وصاحبة التغيير
 * @returns حمولة ServiceLineChanged لتغيير منفّذات سطر واحد
 */
export function linePerformersEvent(input: LinePerformersEventInput) {
  const { record, line, previous, changer } = input;
  return {
    line_id: line.id,
    session_id: record.id,
    service_id: line.service.id,
    branch_id: record.branch_id,
    business_id: record.business_id,
    customer_id: record.customer.id,
    status: 'ACTIVE' as const,
    occurred_at: record.occurred_at.toISOString(),
    recorded_at: line.recorded_at.toISOString(),
    business_date: record.business_date,
    late: line.late,
    recorded_by: line.recorded_by,
    recorded_by_membership_id: line.recorded_by_membership_id,
    list_price: moneyToString(line.service.price),
    price: moneyToString(line.price),
    discount: moneyToString(line.discount),
    net: moneyToString(line.net),
    performers: line.performers.map((performer) => ({
      employee_id: performer.employee.id,
      share_bps: performer.share_bps,
    })),
    rule_snapshot: sessionRuleSnapshot(line.service.rule),
    counts_snapshot: line.service.counts,
    package: null,
    revision: previous.revision + 1,
    change: {
      kind: 'PERFORMERS_CHANGE' as const,
      changed_at: changer.at.toISOString(),
      changed_by: changer.userId,
      changed_by_membership_id: changer.membershipId,
      previous: {
        revision: previous.revision,
        performers: previous.performers.map((performer) => ({
          employee_id: performer.employee_id,
          share_bps: performer.share_bps,
        })),
      },
    },
  };
}
