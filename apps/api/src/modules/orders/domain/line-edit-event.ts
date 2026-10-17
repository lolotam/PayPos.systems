import { moneyToString } from '@pospay/domain';
import { sessionRuleSnapshot } from './session-snapshot.ts';
import type { SessionLine, SessionRecord } from './session-types.ts';

/** القيم السابقة التي يعلنها حدث التعديل؛ النسخة الجديدة تُحسب هنا. */
export interface LineEditEventPrevious {
  revision: number;
  price: bigint;
  discount: bigint;
  net: bigint;
}

/** مدخل حدث سطر واحد بعد الحفظ؛ المسجّلة الأصلية تبقى كما هي. */
export interface LineEditEventInput {
  record: SessionRecord;
  line: SessionLine;
  previous: LineEditEventPrevious;
  editor: { userId: string; membershipId: string; at: Date };
}

/**
 * يبني حدث تغيّر سطر واحد بلا سبب وبلا أسماء، والنسخة هي السابقة زائد واحد.
 * المسجّلة الأصلية تبقى على السطر، والمال يخرج بنص من ثلاث خانات.
 *
 * @param input الزيارة والسطر المحفوظ والقيم السابقة والمحررة
 * @returns حمولة ServiceLineChanged لسطر نشط واحد
 */
export function lineEditEvent(input: LineEditEventInput) {
  const { record, line, previous, editor } = input;
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
    performers: line.performers.map((performer) => ({ employee_id: performer.employee.id, share_bps: performer.share_bps })),
    rule_snapshot: sessionRuleSnapshot(line.service.rule),
    counts_snapshot: line.service.counts,
    package: null,
    revision: previous.revision + 1,
    change: {
      kind: 'PRICE_DISCOUNT_EDIT' as const,
      changed_at: editor.at.toISOString(),
      changed_by: editor.userId,
      changed_by_membership_id: editor.membershipId,
      previous: {
        revision: previous.revision,
        price: moneyToString(previous.price),
        discount: moneyToString(previous.discount),
        net: moneyToString(previous.net),
      },
    },
  };
}
