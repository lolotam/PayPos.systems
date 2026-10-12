import { expect, it } from 'vitest';
import { prepareSessionLines } from '../prepare-session-lines.ts';
import { planSessionWrite, recordedSessionLine, sessionBatchEvent } from '../session-write.ts';
import { sessionLineSnapshot, sessionRuleSnapshot, sessionSnapshot } from '../session-snapshot.ts';
import { sessionAuditEntries } from '../session-audit.ts';
import { resolveSessionRecorder } from '../session-authority.ts';
import type { SessionDraft, SessionEmployee, SessionRecord, SessionService } from '../session-types.ts';
const employee: SessionEmployee = { id: 'employee', name_en: 'Synthetic', name_ar: null, user_id: null, eligible: true, clocked_in: false, approved_leave: true };
const service: SessionService = { id: 'service', name_en: 'Synthetic', name_ar: null, price: 7125n, rule: { kind: 'FIXED', value: 2500n }, counts: true, revision: 2 };
const draft: SessionDraft = { service_id: 'service', price: 7125n, discount: { kind: 'PERCENT', bps: 1000 }, performers: [{ employee_id: 'employee' }] };
const messages = { message_ar: 'synthetic-ar', message_en: 'synthetic-en' };
const at = new Date('2026-10-15T08:00:00Z');
const prepared = () => prepareSessionLines([draft], [service], [employee], 'recorder')[0];
function saved() {
  const p = prepared(); if (p === undefined) throw new Error('Missing prepared line');
  return recordedSessionLine(p, { id: 'line', session_id: 'session', ordinal: 1, performer_ids: ['performer'] },
    { userId: 'recorder', membershipId: 'membership', at, late: true }, { source: 'OWNER', bps: null });
}
function record(): SessionRecord { return { id: 'session', business_id: 'business', branch_id: 'branch', customer: { id: 'customer', name: 'Synthetic', phone_masked: '***123' },
  recorded_by: 'recorder', recorded_by_membership_id: 'membership', occurred_at: at, recorded_at: at,
  business_date: '2026-10-15', business_timezone: 'Asia/Kuwait', late: true, lines: [saved()] }; }
it('validates every non-limit invariant including rejected drafts; warns without changing money/shares', () => {
  expect(prepared()).toMatchObject({ discount: 713n, net: 6412n, has_performer_warning: true, performers: [{ share_bps: 10000, not_clocked_in_warning: true, approved_leave_warning: true }] });
  expect(() => prepareSessionLines([draft], [], [employee], 'recorder')).toThrow('SESSION_SERVICE_NOT_FOUND');
  expect(() => prepareSessionLines([draft], [service], [{ ...employee, eligible: false }], 'recorder')).toThrow('SESSION_PERFORMER_NOT_ELIGIBLE');
  expect(() => prepareSessionLines([draft], [service], [{ ...employee, user_id: 'recorder' }], 'recorder')).toThrow('SESSION_PERFORMER_SELF_FORBIDDEN');
});
it('all-rejected produces complete editing details before any save; unlimited saves the same half-up amount', () => {
  const p = prepared(); if (p === undefined) throw new Error();
  expect(() => planSessionWrite([p], { source: 'PERSON', bps: 1000 }, [], messages)).toThrow('SESSION_DISCOUNT_ABOVE_LIMIT');
  expect(planSessionWrite([p], { source: 'OWNER', bps: null }, [], messages)).toMatchObject({ accepted: [p], rejected_lines: [], ordinals: [1], outcome: 'COMPLETE' });
});
it('all snapshot/event money is KWD 3-dp including fixed rules and maximum; event omits phones and old lines', () => {
  const r = record(), l = saved();
  expect(sessionLineSnapshot(l)).toMatchObject({ list_price: '7.125', discount: '0.713', net: '6.412', rule_snapshot: { kind: 'FIXED', value: '2.500' } });
  expect(sessionSnapshot(r).total_net).toBe('6.412');
  expect(sessionRuleSnapshot({ kind: 'FIXED', value: 99999999999999n })).toEqual({ kind: 'FIXED', value: '99999999999.999' });
  const event = sessionBatchEvent({ ...r, lines: [l,l] }, [l]);
  expect(event.lines).toHaveLength(1); expect(event.lines[0]).toMatchObject({ revision: 1, package: null, net: '6.412' });
  expect(JSON.stringify(event)).not.toContain('phone');
  expect(() => sessionBatchEvent(r,[{ ...l, status: 'CANCELLED' }])).toThrow('Recording events require new active revision-one lines');
  expect(() => sessionBatchEvent(r,[{ ...l, revision: 2 }])).toThrow('Recording events require new active revision-one lines');
});
it('audits only accepted money changes and initial unequal shares with actor, membership and time', () => {
  const l = saved(); const audits = sessionAuditEntries(record(), [{ ...l, explicit_unequal_shares: true }], 'PARTIAL', true);
  expect(audits.map((a) => a.action)).toEqual(['session.lines_added','session.price_discount_recorded']);
  expect(JSON.stringify(audits)).not.toContain('phone');
  expect(audits[1]?.after).toMatchObject({ recorded_by: 'recorder', recorded_by_membership_id: 'membership', recorded_at: at.toISOString() });
  expect(sessionAuditEntries(record(), [{ ...l, price: l.service.price, discount: 0n, net: l.service.price }], 'COMPLETE', false)).toHaveLength(1);
});
it('recorder selection is explicit; original-recorder alternative retains DENY, scope, feature and active membership', () => {
  const access = { record: true, denied: false, feature: true, membership_ids: ['member'] };
  expect(resolveSessionRecorder(access, undefined, undefined, 'actor')).toBe('member');
  expect(() => resolveSessionRecorder({ ...access, membership_ids: ['a','b'] }, undefined, undefined, 'actor')).toThrow('SESSION_RECORDER_MEMBERSHIP_REQUIRED');
  expect(resolveSessionRecorder({ ...access, membership_ids: ['a','b'] }, 'b', undefined, 'actor')).toBe('b');
  expect(() => resolveSessionRecorder(access, 'foreign', undefined, 'actor')).toThrow('FORBIDDEN');
  expect(resolveSessionRecorder({ ...access, record: false }, undefined, 'actor', 'actor')).toBe('member');
  for (const change of [{ denied: true }, { membership_ids: [] }, { feature: false }])
    expect(() => resolveSessionRecorder({ ...access, ...change, record: false }, undefined, 'actor', 'actor')).toThrow();
});
