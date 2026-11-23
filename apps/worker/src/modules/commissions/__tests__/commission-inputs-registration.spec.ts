import { describe, expect, it } from 'vitest';

import { createCommissionInputsConsumer } from '../commissions.module.ts';

// أسماء مكتوبة هنا حرفيًا وبشكل مستقل عن ثوابت @pospay/domain: قراءة ثابت واحد من الجهتين لا تكشف قائمة خاطئة
// في الاثنين. هذه هي القائمة التي تعدّها دالة SQL `statement_pending_commission_events` (ADR-0012 §1).
const COUNTED_BY_THE_APPROVAL_FUNCTION = [
  'ServiceLineChanged',
  'PackageSaleChanged',
  'SalaryChanged',
  'ServiceSessionLinesAdded',
  'ServiceSessionRecorded',
  'SessionTipsChanged',
];

describe('the commission inputs consumer registration', () => {
  const consumer = createCommissionInputsConsumer(
    {} as Parameters<typeof createCommissionInputsConsumer>[0],
  );

  it('registers exactly the six types the pending-count function counts', () => {
    expect([...consumer.eventTypes].sort()).toEqual([...COUNTED_BY_THE_APPROVAL_FUNCTION].sort());
  });

  it('writes its consumed mark under the id the pending-count function looks for', () => {
    expect(consumer.id).toBe('commissions.project-inputs');
  });
});
