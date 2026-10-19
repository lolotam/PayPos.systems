import { moneyToString } from '@pospay/domain';
import { sessionRuleSnapshot } from './session-snapshot.ts';
import type { SessionLine, SessionRecord } from './session-types.ts';

/** القيم السابقة التي يعلنها حدث الإلغاء؛ النسخة الجديدة تُحسب هنا. */
export interface LineCancelEventPrevious {
  revision: number;
  price: bigint;
  discount: bigint;
  net: bigint;
}

/** مدخل حدث إلغاء سطر واحد بعد الحفظ؛ المسجّلة الأصلية تبقى كما هي. */
export interface LineCancelEventInput {
  record: SessionRecord;
  line: SessionLine;
  previous: LineCancelEventPrevious;
  canceller: { userId: string; membershipId: string; at: Date };
}

/**
 * يبني حدث إلغاء سطر واحد بلا سبب وبلا أسماء، والنسخة هي السابقة زائد واحد.
 * المسجّلة الأصلية تبقى على السطر، والحالة CANCELLED لأن الإلغاء نهائي، والمال يخرج بنص من ثلاث خانات.
 *
 * @param input الزيارة والسطر المحفوظ والقيم السابقة والملغية
 * @returns حمولة ServiceLineChanged لسطر ملغى واحد
 */
export function lineCancelEvent(input: LineCancelEventInput) {
  const { record, line, previous, canceller } = input;
  return {
    line_id: line.id,
    session_id: record.id,
    service_id: line.service.id,
    branch_id: record.branch_id,
    business_id: record.business_id,
    customer_id: record.customer.id,
    status: 'CANCELLED' as const,
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
    performers: line.performers.map((performer) => ({ employee_id: performer.employee.id, share_bps: performer.share_bps })),
    rule_snapshot: sessionRuleSnapshot(line.service.rule),
    counts_snapshot: line.service.counts,
    package: null,
    revision: previous.revision + 1,
    change: {
      kind: 'LINE_CANCELLED' as const,
      changed_at: canceller.at.toISOString(),
      changed_by: canceller.userId,
      changed_by_membership_id: canceller.membershipId,
      previous: {
        revision: previous.revision,
        price: moneyToString(previous.price),
        discount: moneyToString(previous.discount),
        net: moneyToString(previous.net),
      },
    },
  };
}
