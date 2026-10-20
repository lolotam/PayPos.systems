import { expect, it } from 'vitest';
import { linePerformersAudit } from '../line-performers-audit.ts';

const keys = [
  'change_id',
  'changed_at',
  'changer_membership_id',
  'changer_user_id',
  'line_id',
  'performers_after',
  'performers_before',
  'revision_after',
  'revision_before',
  'session_id',
];

const before = [
  { employee_id: '01990000-0000-7000-8000-00000000000b', share_bps: 10000 },
];
const after = [
  { employee_id: '01990000-0000-7000-8000-00000000000c', share_bps: 6000 },
  { employee_id: '01990000-0000-7000-8000-00000000000b', share_bps: 4000 },
];

function audit(over: Partial<Parameters<typeof linePerformersAudit>[0]> = {}) {
  return linePerformersAudit({
    sessionId: '01990000-0000-7000-8000-000000000002',
    lineId: '01990000-0000-7000-8000-000000000001',
    changeId: '01990000-0000-7000-8000-00000000000d',
    revisionBefore: 1,
    changerUserId: '01990000-0000-7000-8000-000000000009',
    changerMembershipId: '01990000-0000-7000-8000-00000000000a',
    changedAt: new Date('2026-10-15T08:00:00.000Z'),
    performersBefore: before,
    performersAfter: after,
    ...over,
  });
}

it('builds a performers audit entry with the revision after and both sets in order', () => {
  const entry = audit();
  expect(entry.entity).toBe('service_line');
  expect(entry.entityId).toBe('01990000-0000-7000-8000-000000000001');
  expect(entry.action).toBe('service_line.performers_changed');
  expect(entry.after.revision_before).toBe(1);
  expect(entry.after.revision_after).toBe(2);
  expect(entry.after.performers_before).toEqual(before);
  expect(entry.after.performers_after).toEqual(after);
  expect(entry.after.changed_at).toBe('2026-10-15T08:00:00.000Z');
  expect(Object.keys(entry.after).sort()).toEqual(keys);
});

it('keeps the given order of both performer sets', () => {
  const entry = audit({ performersBefore: after, performersAfter: before });
  expect(entry.after.performers_before).toEqual(after);
  expect(entry.after.performers_after).toEqual(before);
});

it('carries no reason, names, phone, or money', () => {
  const text = JSON.stringify(audit());
  expect(text).not.toContain('reason');
  expect(text).not.toContain('name_');
  expect(text).not.toContain('phone');
  expect(text).not.toContain('net');
  expect(text).not.toContain('price');
});
