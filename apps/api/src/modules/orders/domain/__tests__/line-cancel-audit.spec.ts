import { expect, it } from 'vitest';
import { lineCancelAudit } from '../line-cancel-audit.ts';

const keys = ['cancellation_id', 'cancelled_at', 'canceller_membership_id', 'canceller_user_id', 'discount', 'line_id', 'net', 'price', 'revision_after', 'revision_before', 'session_id'];

it('builds a cancel audit entry without a reason, names, or phone', () => {
  const entry = lineCancelAudit({
    sessionId: '01990000-0000-7000-8000-000000000002', lineId: '01990000-0000-7000-8000-000000000001',
    cancellationId: '01990000-0000-7000-8000-00000000000d', revisionBefore: 1,
    cancellerUserId: '01990000-0000-7000-8000-000000000009', cancellerMembershipId: '01990000-0000-7000-8000-00000000000a',
    cancelledAt: new Date('2026-10-15T08:00:00.000Z'),
    figures: { price: 25000n, discount: 0n, net: 25000n },
  });
  expect(entry.entity).toBe('service_line');
  expect(entry.entityId).toBe('01990000-0000-7000-8000-000000000001');
  expect(entry.action).toBe('service_line.cancelled');
  expect(entry.after.revision_before).toBe(1);
  expect(entry.after.revision_after).toBe(2);
  expect(entry.after.price).toBe('25.000');
  expect(entry.after.net).toBe('25.000');
  expect(Object.keys(entry.after).sort()).toEqual(keys);
  const text = JSON.stringify(entry);
  expect(text).not.toContain('reason');
  expect(text).not.toContain('name_');
  expect(text).not.toContain('phone');
});
