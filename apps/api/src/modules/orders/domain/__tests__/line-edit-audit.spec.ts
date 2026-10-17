import { expect, it } from 'vitest';
import { lineEditAudit } from '../line-edit-audit.ts';

const keys = ['changed_at', 'edit_id', 'editor_membership_id', 'editor_user_id', 'effective_discount_bps', 'limit_bps_applied', 'limit_source', 'line_id', 'new_discount', 'new_net', 'new_price', 'previous_discount', 'previous_net', 'previous_price', 'revision_after', 'revision_before', 'session_id'];

it('builds an audit entry without a reason, names, or phone and keeps a null limit', () => {
  const entry = lineEditAudit({
    sessionId: '01990000-0000-7000-8000-000000000002', lineId: '01990000-0000-7000-8000-000000000001',
    editId: '01990000-0000-7000-8000-00000000000d', revisionBefore: 4,
    editorUserId: '01990000-0000-7000-8000-000000000009', editorMembershipId: '01990000-0000-7000-8000-00000000000a',
    changedAt: new Date('2026-10-15T08:00:00.000Z'),
    previous: { price: 25000n, discount: 2500n, net: 22500n },
    next: { price: 25000n, discount: 5000n, net: 20000n, effective_discount_bps: 2000, limit_bps_applied: null, limit_source: 'OWNER' },
  });
  expect(entry.entity).toBe('service_line');
  expect(entry.entityId).toBe('01990000-0000-7000-8000-000000000001');
  expect(entry.action).toBe('service_line.price_discount_edited');
  expect(entry.after.revision_before).toBe(4);
  expect(entry.after.revision_after).toBe(5);
  expect(entry.after.limit_bps_applied).toBeNull();
  expect(Object.keys(entry.after).sort()).toEqual(keys);
  expect(entry.after.previous_price).toBe('25.000');
  expect(entry.after.new_net).toBe('20.000');
  const text = JSON.stringify(entry);
  expect(text).not.toContain('reason');
  expect(text).not.toContain('name_');
  expect(text).not.toContain('phone');
});
