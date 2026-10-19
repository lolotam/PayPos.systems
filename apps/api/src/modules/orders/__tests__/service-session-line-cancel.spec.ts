import { cancelServiceLineResponse, serviceLineChanged } from '@pospay/contracts';
import { SYSTEM_ROLES } from '@pospay/db';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { AT, ids, must } from './session.fixture.ts';
import { branchManager } from './line-edit.helpers.ts';
import {
  cancelFixture,
  cancelFootprint,
  cancelInput,
  cancelOnlyRole,
  cancelQuiet,
  cancelRows,
  expectHidden,
  pairLines,
  payloadOf,
  performersOf,
  runCancel,
  scopedMember,
  sessionStamp,
  visitOf,
  type CancelFixture,
} from './line-cancel.helpers.ts';

let f: CancelFixture;
const managerRole = must(SYSTEM_ROLES.find((item) => item.code === 'branch_manager')).id;
beforeAll(async () => { f = await cancelFixture(); });
afterAll(async () => { await f?.close(); });

it('LC-01 a manager cancel stores one history row, one audit, one event and the full 200 body', async () => {
  const visit = await visitOf(f, pairLines(f));
  const line = must(visit.lines[1]);
  const reason = `sentinel-reason-${ids.newId()}`;
  const key = ids.newId();
  const result = cancelServiceLineResponse.parse(await runCancel(f, visit.sessionId, line.id, cancelInput({ reason }), { key }));
  expect(result).toMatchObject({
    line: { id: line.id, status: 'CANCELLED', revision: 2, price: '7.125', discount: '0.000', net: '7.125', recorded_by: f.userId, cancelled_at: AT.toISOString() },
    session: { id: visit.sessionId, total_net: '25.000' },
  });
  const saved = await cancelRows(f, visit.sessionId, line.id);
  expect(saved.line).toMatchObject({ status: 'CANCELLED', revision: 2, price: '7.125', discount: '0.000', net: '7.125', recorded_by: f.userId });
  expect(saved.cancellations).toHaveLength(1);
  expect(saved.events).toHaveLength(1);
  expect(saved.audits).toHaveLength(1);
  expect(saved.cancellations[0]).toMatchObject({
    revision: 2, previous_revision: 1, previous_price: '7.125', previous_discount: '0.000', previous_net: '7.125', reason,
    cancelled_by: f.editorId, cancelled_by_membership_id: f.editorMembership, canceller_name_ar: 'ليلى', canceller_name_en: 'Layla Editor',
    canceller_role: 'branch_manager', canceller_role_is_system: true, canceller_role_name_en: 'Branch Manager', canceller_role_name_ar: null,
  });
  expect(new Date(saved.cancellations[0]?.['cancelled_at'] as string | Date).toISOString()).toBe(AT.toISOString());
  expect(payloadOf(saved.audits[0]?.['after'])).toMatchObject({
    session_id: visit.sessionId, line_id: line.id, revision_before: 1, revision_after: 2,
    canceller_user_id: f.editorId, canceller_membership_id: f.editorMembership, cancelled_at: AT.toISOString(),
    price: '7.125', discount: '0.000', net: '7.125',
  });
  const [stored] = await f.h.owner`SELECT response_status FROM idempotency_keys WHERE company_id=${f.company} AND key=${key}`;
  expect(stored?.['response_status']).toBe(200);
  expect(await expectHidden(f, visit.sessionId, line.id, key, reason, result)).toBe(0);
});

it('LC-02 keeps the money, the recorder and the performers, and a cancelled line still fills one of the 20 persisted slots', async () => {
  const service = must(f.services[0]);
  const last = f.line(must(f.services[1]), '7.125', '0.000');
  const lines = [
    ...Array.from({ length: 19 }, () => f.line(service, '25.000', '0.000')),
    { ...last, performers: [{ employee_id: must(f.employees[1]) }] },
  ];
  const visit = await visitOf(f, lines);
  const line = must(visit.lines[19]);
  const performers = await performersOf(f, line.id);
  const stamp = await sessionStamp(f, visit.sessionId);
  await runCancel(f, visit.sessionId, line.id);
  const saved = await cancelRows(f, visit.sessionId, line.id);
  expect(saved.line).toMatchObject({ price: '7.125', discount: '0.000', net: '7.125', recorded_by: f.userId, status: 'CANCELLED' });
  expect(await performersOf(f, line.id)).toEqual(performers);
  expect(await sessionStamp(f, visit.sessionId)).toBe(stamp);
  const persisted = await f.h.owner`SELECT status, ordinal FROM service_lines WHERE company_id=${f.company} AND session_id=${visit.sessionId} ORDER BY ordinal`;
  expect(persisted.map((row) => row['status'])).toEqual([...Array.from({ length: 19 }, () => 'ACTIVE'), 'CANCELLED']);
  expect(persisted.map((row) => Number(row['ordinal']))).toEqual(Array.from({ length: 20 }, (_, index) => index + 1));
  await expect(f.append.execute({ ...f.context(), sessionId: visit.sessionId, input: { lines: [f.line()] } })).rejects.toThrow('SESSION_LINE_CAPACITY_EXCEEDED');
  expect(await f.h.owner`SELECT 1 FROM service_lines WHERE company_id=${f.company} AND session_id=${visit.sessionId}`).toHaveLength(20);
});

it('LC-03 the event is the cancelled line and names the manager, not the cashier', async () => {
  const visit = await visitOf(f, pairLines(f));
  const line = must(visit.lines[1]);
  await runCancel(f, visit.sessionId, line.id);
  const saved = await cancelRows(f, visit.sessionId, line.id);
  const event = serviceLineChanged.parse(payloadOf(must(saved.events[0])['payload']));
  expect(event.status).toBe('CANCELLED');
  expect(event.revision).toBe(2);
  expect(event.recorded_by).toBe(f.userId);
  expect(event.change).toMatchObject({
    kind: 'LINE_CANCELLED', changed_by: f.editorId, changed_by_membership_id: f.editorMembership,
    previous: { revision: 1, price: '7.125', discount: '0.000', net: '7.125' },
  });
});

it('LC-04 a cashier, a device and a disabled feature write nothing', async () => {
  const device = await scopedMember(f, 'cancel-device@example.test', 'device', 'BRANCH', f.branch);
  const cashier = await visitOf(f);
  const cashierKey = ids.newId();
  await expect(runCancel(f, cashier.sessionId, must(cashier.lines[0]).id, cancelInput(), { userId: f.userId, key: cashierKey })).rejects.toThrow('FORBIDDEN');
  expect(await cancelQuiet(f, cashier.sessionId, must(cashier.lines[0]).id, cashierKey)).toEqual({ cancellations: 0, audits: 0, events: 0, keys: 0 });
  const deviceVisit = await visitOf(f);
  const deviceKey = ids.newId();
  await expect(runCancel(f, deviceVisit.sessionId, must(deviceVisit.lines[0]).id, cancelInput(), { userId: device.userId, key: deviceKey })).rejects.toThrow('FORBIDDEN');
  expect(await cancelQuiet(f, deviceVisit.sessionId, must(deviceVisit.lines[0]).id, deviceKey)).toEqual({ cancellations: 0, audits: 0, events: 0, keys: 0 });
  const gated = await visitOf(f);
  const gatedKey = ids.newId();
  await f.h.owner`INSERT INTO company_feature_overrides(company_id,flag,enabled,reason,set_by) VALUES(${f.company},'orders',false,'Synthetic feature',${f.ownerId})`;
  try {
    await expect(runCancel(f, gated.sessionId, must(gated.lines[0]).id, cancelInput(), { key: gatedKey })).rejects.toThrow('FEATURE_DISABLED');
    expect(await cancelQuiet(f, gated.sessionId, must(gated.lines[0]).id, gatedKey)).toEqual({ cancellations: 0, audits: 0, events: 0, keys: 0 });
  } finally {
    await f.h.owner`DELETE FROM company_feature_overrides WHERE company_id=${f.company} AND flag='orders'`;
  }
});

it('LC-04 the owner, both managers and a granted company role can cancel', async () => {
  const general = await scopedMember(f, 'cancel-general@example.test', 'general_manager', 'COMPANY', f.company);
  const business = await scopedMember(f, 'cancel-business@example.test', 'business_manager', 'BUSINESS', f.business);
  const custom = await cancelOnlyRole(f, 'cancel-custom@example.test');
  const owner = await visitOf(f);
  expect(await runCancel(f, owner.sessionId, must(owner.lines[0]).id, cancelInput(), { userId: f.ownerId })).toMatchObject({ line: { status: 'CANCELLED', revision: 2 } });
  const generalVisit = await visitOf(f);
  expect(await runCancel(f, generalVisit.sessionId, must(generalVisit.lines[0]).id, cancelInput(), { userId: general.userId })).toMatchObject({ line: { status: 'CANCELLED' } });
  const businessVisit = await visitOf(f);
  expect(await runCancel(f, businessVisit.sessionId, must(businessVisit.lines[0]).id, cancelInput(), { userId: business.userId })).toMatchObject({ line: { status: 'CANCELLED' } });
  const narrowVisit = await visitOf(f);
  const key = ids.newId();
  const narrow = await runCancel(f, narrowVisit.sessionId, must(narrowVisit.lines[0]).id, cancelInput(), { userId: custom.userId, key });
  expect(narrow).toEqual({ cancelled: true });
  const [stored] = await f.h.owner`SELECT response_body::text AS body FROM idempotency_keys WHERE company_id=${f.company} AND key=${key}`;
  expect(String(stored?.['body'])).toContain('25.000');
  expect(String(stored?.['body'])).not.toContain('Synthetic cancel reason');
});

it('LC-04 a company deny of cancel forbids the call and writes nothing', async () => {
  const membershipId = ids.newId();
  const overrideId = ids.newId();
  await f.h.owner`INSERT INTO memberships(company_id,id,user_id,role_id,role_owner_key,scope_type,scope_id,limit_bps,starts_at)
    VALUES(${f.company},${membershipId},${f.editorId},${managerRole},'global','BRANCH',${f.secondBranch},2000,'2026-01-01T00:00:00Z')`;
  await f.h.owner`INSERT INTO permission_overrides(company_id,id,membership_id,permission_code,effect,scope_type,scope_id,reason,granted_by)
    VALUES(${f.company},${overrideId},${membershipId},'cancel:service-lines:branch','DENY','COMPANY',${f.company},'Synthetic distant deny',${f.ownerId})`;
  try {
    const visit = await visitOf(f);
    const key = ids.newId();
    await expect(runCancel(f, visit.sessionId, must(visit.lines[0]).id, cancelInput(), { key })).rejects.toThrow('FORBIDDEN');
    expect(await cancelQuiet(f, visit.sessionId, must(visit.lines[0]).id, key)).toEqual({ cancellations: 0, audits: 0, events: 0, keys: 0 });
  } finally {
    await f.h.owner`DELETE FROM permission_overrides WHERE company_id=${f.company} AND id=${overrideId}`;
    await f.h.owner`DELETE FROM memberships WHERE company_id=${f.company} AND id=${membershipId}`;
  }
});

it('LC-05 a performer-linked canceller, including the owner, is refused and nothing is written', async () => {
  const performer = must(f.employees[0]);
  try {
    await f.h.owner`UPDATE employees SET deleted_at=now() WHERE company_id=${f.company} AND id=${f.editorEmployee}`;
    await f.linkEmployee(performer, f.editorId);
    const managed = await visitOf(f);
    const managerKey = ids.newId();
    await expect(runCancel(f, managed.sessionId, must(managed.lines[0]).id, cancelInput(), { key: managerKey })).rejects.toThrow('SESSION_PERFORMER_SELF_FORBIDDEN');
    expect(await cancelQuiet(f, managed.sessionId, must(managed.lines[0]).id, managerKey)).toEqual({ cancellations: 0, audits: 0, events: 0, keys: 0 });
    await f.linkEmployee(performer, f.ownerId);
    const owned = await visitOf(f);
    const ownerKey = ids.newId();
    await expect(runCancel(f, owned.sessionId, must(owned.lines[0]).id, cancelInput(), { userId: f.ownerId, key: ownerKey })).rejects.toThrow('SESSION_PERFORMER_SELF_FORBIDDEN');
    expect(await cancelQuiet(f, owned.sessionId, must(owned.lines[0]).id, ownerKey)).toEqual({ cancellations: 0, audits: 0, events: 0, keys: 0 });
  } finally {
    await f.linkEmployee(performer, null);
    await f.h.owner`UPDATE employees SET deleted_at=NULL WHERE company_id=${f.company} AND id=${f.editorEmployee}`;
  }
});

it('LC-06 a moved link, a later link and any of several performers are refused', async () => {
  const first = await branchManager(f, 'cancel-editor-u1@example.test');
  const second = await branchManager(f, 'cancel-editor-u2@example.test');
  const performer = must(f.employees[0]);
  const other = must(f.employees[1]);
  try {
    await f.linkEmployee(performer, first.userId);
    const relinked = await visitOf(f);
    const lineId = must(relinked.lines[0]).id;
    await f.linkEmployee(performer, second.userId);
    await expect(runCancel(f, relinked.sessionId, lineId, cancelInput(), { userId: first.userId })).rejects.toThrow('SESSION_PERFORMER_SELF_FORBIDDEN');
    await expect(runCancel(f, relinked.sessionId, lineId, cancelInput(), { userId: second.userId })).rejects.toThrow('SESSION_PERFORMER_SELF_FORBIDDEN');
    expect(await runCancel(f, relinked.sessionId, lineId)).toMatchObject({ line: { revision: 2, recorded_by: f.userId } });
    await f.linkEmployee(performer, null);
    const later = await visitOf(f);
    await f.linkEmployee(performer, second.userId);
    await expect(runCancel(f, later.sessionId, must(later.lines[0]).id, cancelInput(), { userId: second.userId })).rejects.toThrow('SESSION_PERFORMER_SELF_FORBIDDEN');
    await f.linkEmployee(performer, first.userId);
    const base = f.line(must(f.services[0]), '25.000', '0.000');
    const several = await visitOf(f, [{ ...base, performers: [{ employee_id: performer }, { employee_id: other }] }]);
    await f.linkEmployee(other, second.userId);
    await expect(runCancel(f, several.sessionId, must(several.lines[0]).id, cancelInput(), { userId: first.userId })).rejects.toThrow('SESSION_PERFORMER_SELF_FORBIDDEN');
    await expect(runCancel(f, several.sessionId, must(several.lines[0]).id, cancelInput(), { userId: second.userId })).rejects.toThrow('SESSION_PERFORMER_SELF_FORBIDDEN');
  } finally {
    await f.linkEmployee(performer, null);
    await f.linkEmployee(other, null);
    await f.h.owner`DELETE FROM memberships WHERE company_id=${f.company} AND id IN (${first.membershipId}, ${second.membershipId})`;
  }
});

it('LC-07 a performer without a stored identity snapshot cannot be cancelled', async () => {
  const visit = await visitOf(f);
  await f.snapshotPerformers(must(visit.lines[0]).id, [{ employee_id: must(f.employees[0]), linked_user_id: null, linked_user_snapshotted: false }]);
  await expect(runCancel(f, visit.sessionId, must(visit.lines[0]).id)).rejects.toThrow('SESSION_LINE_IDENTITY_UNKNOWN');
});

it('LC-09 partial: an in-window cancel is accepted and orders writes only the cancellation artifacts; approved or paid month is not seedable yet', async () => {
  // جداول كشف العمولة لصفوف 50/55 مش في المخطط، فالشهر المعتمد ما يتزرعش؛ الإلغاء جوه النافذة بينجح والأوردرز يكتب أثر الإلغاء بس.
  const visit = await visitOf(f);
  const line = must(visit.lines[0]);
  const before = await f.h.owner`SELECT event_type FROM outbox WHERE company_id=${f.company} AND aggregate_id=${visit.sessionId} ORDER BY event_type`;
  await runCancel(f, visit.sessionId, line.id);
  const saved = await cancelRows(f, visit.sessionId, line.id);
  expect(saved.cancellations).toHaveLength(1);
  expect(saved.audits).toHaveLength(1);
  expect(saved.events).toHaveLength(1);
  const after = await f.h.owner`SELECT event_type FROM outbox WHERE company_id=${f.company} AND aggregate_id=${visit.sessionId} AND event_type<>'ServiceSessionRecorded'`;
  expect(before.map((row) => row['event_type'])).not.toContain('ServiceLineChanged');
  expect(after.map((row) => row['event_type'])).toEqual(['ServiceLineChanged']);
});

it('several eligible memberships require an explicit canceller, and a foreign one is forbidden', async () => {
  const visit = await visitOf(f);
  const lineId = must(visit.lines[0]).id;
  await expect(runCancel(f, visit.sessionId, lineId, cancelInput({ canceller_membership_id: ids.newId() }))).rejects.toThrow('FORBIDDEN');
  const extra = ids.newId();
  try {
    await f.h.owner`INSERT INTO memberships(company_id,id,user_id,role_id,role_owner_key,scope_type,scope_id,limit_bps,starts_at)
      SELECT ${f.company},${extra},${f.editorId},role_id,role_owner_key,'COMPANY',${f.company},2000,'2026-01-01T00:00:00Z'
      FROM memberships WHERE company_id=${f.company} AND id=${f.editorMembership}`;
    const ambiguous = await runCancel(f, visit.sessionId, lineId).then(() => null, (error: unknown) => error);
    expect(ambiguous).toMatchObject({ code: 'SESSION_CANCELLER_MEMBERSHIP_REQUIRED' });
    const idsOnError = (ambiguous as { details: { canceller_membership_ids: string[] } }).details.canceller_membership_ids;
    expect([...idsOnError].sort()).toEqual([extra, f.editorMembership].sort());
    expect(await runCancel(f, visit.sessionId, lineId, cancelInput({ canceller_membership_id: f.editorMembership }))).toMatchObject({ line: { revision: 2 } });
  } finally {
    await f.h.owner`UPDATE memberships SET ends_at='2026-10-14T00:00:00Z' WHERE company_id=${f.company} AND id=${extra}`;
  }
});

it('a missing, foreign or wrong-branch line is forbidden and writes nothing', async () => {
  const visit = await visitOf(f);
  const other = await visitOf(f);
  const before = await cancelFootprint(f);
  await expect(runCancel(f, visit.sessionId, ids.newId())).rejects.toThrow('FORBIDDEN');
  await expect(runCancel(f, visit.sessionId, must(other.lines[0]).id)).rejects.toThrow('FORBIDDEN');
  await expect(runCancel(f, visit.sessionId, must(visit.lines[0]).id, cancelInput(), { branchId: f.secondBranch })).rejects.toThrow('FORBIDDEN');
  await expect(runCancel(f, visit.sessionId, must(visit.lines[0]).id, cancelInput(), { companyId: f.otherCompany, businessId: f.foreignBusiness, branchId: f.foreignBranch })).rejects.toThrow('FORBIDDEN');
  expect(await cancelFootprint(f)).toEqual(before);
});

it('cancelling the last active line leaves a derived total of zero', async () => {
  const visit = await visitOf(f);
  const saved = cancelServiceLineResponse.parse(await runCancel(f, visit.sessionId, must(visit.lines[0]).id));
  expect(saved).toMatchObject({ line: { status: 'CANCELLED' }, session: { total_net: '0.000' } });
});
