import { afterAll, beforeAll, expect, it } from 'vitest';
import { ids, must } from './session.fixture.ts';
import {
  changeQuiet,
  createEmployee,
  livePerformers,
  newOperatorUser,
  performersFixture,
  performersInput,
  performersOnlyRole,
  runChange,
  scopedMember,
  visitOf,
  type PerformersFixture,
} from './line-performers.helpers.ts';

let f: PerformersFixture;
beforeAll(async () => { f = await performersFixture(); });
afterAll(async () => { await f?.close(); });

it('PC-07 a cashier, a device and a disabled feature write nothing', async () => {
  const device = await scopedMember(f, 'performers-device@example.test', 'device', 'BRANCH', f.branch);
  const cashier = await visitOf(f);
  const cashierLine = must(cashier.lines[0]).id;
  const cashierKey = ids.newId();
  await expect(runChange(f, cashier.sessionId, cashierLine, performersInput({ performers: [{ employee_id: must(f.employees[1]) }] }), { userId: f.userId, key: cashierKey })).rejects.toMatchObject({ code: 'FORBIDDEN' });
  expect(await changeQuiet(f, cashier.sessionId, cashierLine, cashierKey)).toEqual({ headers: 0, audits: 0, events: 0, keys: 0 });
  const deviceVisit = await visitOf(f);
  const deviceLine = must(deviceVisit.lines[0]).id;
  const deviceKey = ids.newId();
  await expect(runChange(f, deviceVisit.sessionId, deviceLine, performersInput({ performers: [{ employee_id: must(f.employees[1]) }] }), { userId: device.userId, key: deviceKey })).rejects.toMatchObject({ code: 'FORBIDDEN' });
  expect(await changeQuiet(f, deviceVisit.sessionId, deviceLine, deviceKey)).toEqual({ headers: 0, audits: 0, events: 0, keys: 0 });
  const gated = await visitOf(f);
  const gatedLine = must(gated.lines[0]).id;
  const gatedKey = ids.newId();
  await f.h.owner`INSERT INTO company_feature_overrides(company_id,flag,enabled,reason,set_by) VALUES(${f.company},'orders',false,'Synthetic feature',${f.ownerId})`;
  try {
    await expect(runChange(f, gated.sessionId, gatedLine, performersInput({ performers: [{ employee_id: must(f.employees[1]) }] }), { key: gatedKey })).rejects.toMatchObject({ code: 'FEATURE_DISABLED' });
    expect(await changeQuiet(f, gated.sessionId, gatedLine, gatedKey)).toEqual({ headers: 0, audits: 0, events: 0, keys: 0 });
    await expect(runChange(f, gated.sessionId, ids.newId(), performersInput({ performers: [{ employee_id: must(f.employees[1]) }] }))).rejects.toMatchObject({ code: 'FEATURE_DISABLED' });
  } finally {
    await f.h.owner`DELETE FROM company_feature_overrides WHERE company_id=${f.company} AND flag='orders'`;
  }
});

it('PC-07 the owner, both managers and a company role granted only this permission succeed', async () => {
  const general = await scopedMember(f, 'performers-general@example.test', 'general_manager', 'COMPANY', f.company);
  const business = await scopedMember(f, 'performers-business@example.test', 'business_manager', 'BUSINESS', f.business);
  const custom = await performersOnlyRole(f, 'performers-custom@example.test');
  const owner = await visitOf(f);
  expect(await runChange(f, owner.sessionId, must(owner.lines[0]).id, performersInput({ performers: [{ employee_id: must(f.employees[1]) }] }), { userId: f.ownerId })).toMatchObject({ line: { revision: 2 } });
  const generalVisit = await visitOf(f);
  expect(await runChange(f, generalVisit.sessionId, must(generalVisit.lines[0]).id, performersInput({ performers: [{ employee_id: must(f.employees[1]) }] }), { userId: general.userId })).toMatchObject({ line: { revision: 2 } });
  const businessVisit = await visitOf(f);
  expect(await runChange(f, businessVisit.sessionId, must(businessVisit.lines[0]).id, performersInput({ performers: [{ employee_id: must(f.employees[1]) }] }), { userId: business.userId })).toMatchObject({ line: { revision: 2 } });
  const narrowVisit = await visitOf(f);
  const key = ids.newId();
  expect(await runChange(f, narrowVisit.sessionId, must(narrowVisit.lines[0]).id, performersInput({ performers: [{ employee_id: must(f.employees[1]) }] }), { userId: custom.userId, key })).toEqual({ changed: true });
  const [stored] = await f.h.owner`SELECT response_body::text AS body FROM idempotency_keys WHERE company_id=${f.company} AND key=${key}`;
  expect(String(stored?.['body'])).toContain('25.000');
  expect(String(stored?.['body'])).not.toContain('Synthetic performers reason');
});

it('PC-08 the recording-time link alone forbids the changer', async () => {
  const performer = must(f.employees[0]);
  await f.linkEmployee(f.editorEmployee, null);
  await f.linkEmployee(performer, f.editorId);
  try {
    const visit = await visitOf(f);
    const line = must(visit.lines[0]).id;
    await f.linkEmployee(performer, null);
    const key = ids.newId();
    await expect(runChange(f, visit.sessionId, line, performersInput({ performers: [{ employee_id: must(f.employees[1]) }] }), { key })).rejects.toMatchObject({ code: 'SESSION_PERFORMER_SELF_FORBIDDEN' });
    expect(await changeQuiet(f, visit.sessionId, line, key)).toEqual({ headers: 0, audits: 0, events: 0, keys: 0 });
    expect((await livePerformers(f, line)).map((row) => row['employee_id'])).toEqual([performer]);
  } finally {
    await f.linkEmployee(performer, null);
    await f.linkEmployee(f.editorEmployee, f.editorId);
  }
});

it('PC-08 the current link alone forbids the changer, the owner included', async () => {
  const performer = must(f.employees[0]);
  // التسجيل بلا رابط: اللقطة فارغة، فيُختبر مصدر الرابط الحالي وحده.
  const visit = await visitOf(f);
  const line = must(visit.lines[0]).id;
  await f.linkEmployee(f.editorEmployee, null);
  await f.linkEmployee(performer, f.editorId);
  try {
    const key = ids.newId();
    await expect(runChange(f, visit.sessionId, line, performersInput({ performers: [{ employee_id: must(f.employees[1]) }] }), { key })).rejects.toMatchObject({ code: 'SESSION_PERFORMER_SELF_FORBIDDEN' });
    expect(await changeQuiet(f, visit.sessionId, line, key)).toEqual({ headers: 0, audits: 0, events: 0, keys: 0 });
    await f.linkEmployee(performer, f.ownerId);
    const ownerKey = ids.newId();
    await expect(runChange(f, visit.sessionId, line, performersInput({ performers: [{ employee_id: must(f.employees[1]) }] }), { userId: f.ownerId, key: ownerKey })).rejects.toMatchObject({ code: 'SESSION_PERFORMER_SELF_FORBIDDEN' });
    expect(await changeQuiet(f, visit.sessionId, line, ownerKey)).toEqual({ headers: 0, audits: 0, events: 0, keys: 0 });
  } finally {
    await f.linkEmployee(performer, null);
    await f.linkEmployee(f.editorEmployee, f.editorId);
  }
});

it('PC-09 putting the changer on the line is refused before the shares and the eligibility', async () => {
  const visit = await visitOf(f);
  const line = must(visit.lines[0]).id;
  const key = ids.newId();
  await expect(runChange(f, visit.sessionId, line, performersInput({
    performers: [{ employee_id: must(f.employees[0]), share_bps: 5000 }, { employee_id: f.editorEmployee, share_bps: 5000 }],
  }), { key })).rejects.toThrow('SESSION_PERFORMER_SELF_FORBIDDEN');
  expect(await changeQuiet(f, visit.sessionId, line, key)).toEqual({ headers: 0, audits: 0, events: 0, keys: 0 });
  const fiveKey = ids.newId();
  await expect(runChange(f, visit.sessionId, line, performersInput({
    performers: [
      { employee_id: must(f.employees[0]), share_bps: 2000 },
      { employee_id: must(f.employees[1]), share_bps: 2000 },
      { employee_id: must(f.employees[2]), share_bps: 2000 },
      { employee_id: must(f.employees[3]), share_bps: 2000 },
      { employee_id: f.editorEmployee, share_bps: 2000 },
    ],
  }), { key: fiveKey })).rejects.toThrow('SESSION_PERFORMER_SELF_FORBIDDEN');
  expect(await changeQuiet(f, visit.sessionId, line, fiveKey)).toEqual({ headers: 0, audits: 0, events: 0, keys: 0 });
  expect((await livePerformers(f, line)).map((row) => row['employee_id'])).toEqual([must(f.employees[0])]);
});

it('PC-09 an added performer linked to the changer is refused even when she is ineligible', async () => {
  await f.linkEmployee(f.editorEmployee, null);
  const added = await createEmployee(f, { user_id: f.editorId, branch_from: '2026-11-01' });
  try {
    const visit = await visitOf(f);
    const line = must(visit.lines[0]).id;
    const key = ids.newId();
    await expect(runChange(f, visit.sessionId, line, performersInput({
      performers: [{ employee_id: must(f.employees[0]), share_bps: 5000 }, { employee_id: added, share_bps: 5000 }],
    }), { key })).rejects.toMatchObject({ code: 'SESSION_PERFORMER_SELF_FORBIDDEN' });
    expect(await changeQuiet(f, visit.sessionId, line, key)).toEqual({ headers: 0, audits: 0, events: 0, keys: 0 });
  } finally {
    // الموظفة المضافة تُفكّ قبل موظفة المحررة، فلا يجتمع مستخدمان على موظفتين نشطتين في النشاط.
    await f.linkEmployee(added, null);
    await f.linkEmployee(f.editorEmployee, f.editorId);
  }
});

it('PC-10 a performer removed by another manager still forbids her linked user', async () => {
  const visit = await visitOf(f, [editorLine(f)]);
  const line = must(visit.lines[0]).id;
  await runChange(f, visit.sessionId, line, performersInput({ performers: [{ employee_id: must(f.employees[0]) }] }), { userId: f.ownerId });
  const key = ids.newId();
  const before = await changeQuiet(f, visit.sessionId, line, key);
  await expect(runChange(f, visit.sessionId, line, performersInput({ expected_revision: 2, performers: [{ employee_id: must(f.employees[1]) }] }), { key })).rejects.toMatchObject({ code: 'SESSION_PERFORMER_SELF_FORBIDDEN' });
  expect(await changeQuiet(f, visit.sessionId, line, key)).toEqual({ ...before, keys: 0 });
  expect(await runChange(f, visit.sessionId, line, performersInput({ expected_revision: 2, performers: [{ employee_id: must(f.employees[1]) }] }), { userId: f.ownerId })).toMatchObject({ line: { revision: 3 } });
});

it('PC-10 a removed performer whose link is gone still forbids her recorded user', async () => {
  const visit = await visitOf(f, [editorLine(f)]);
  const line = must(visit.lines[0]).id;
  await runChange(f, visit.sessionId, line, performersInput({ performers: [{ employee_id: must(f.employees[0]) }] }), { userId: f.ownerId });
  // الرابط زال بعد الإزالة، فلم يبقَ إلا لقطة التسجيل.
  await f.linkEmployee(f.editorEmployee, null);
  try {
    const key = ids.newId();
    const before = await changeQuiet(f, visit.sessionId, line, key);
    await expect(runChange(f, visit.sessionId, line, performersInput({ expected_revision: 2, performers: [{ employee_id: must(f.employees[1]) }] }), { key })).rejects.toMatchObject({ code: 'SESSION_PERFORMER_SELF_FORBIDDEN' });
    expect(await changeQuiet(f, visit.sessionId, line, key)).toEqual({ ...before, keys: 0 });
  } finally {
    await f.linkEmployee(f.editorEmployee, f.editorId);
  }
});

it('PC-10 a re-added performer still forbids her recorded user', async () => {
  const other = await newOperatorUser(f, 'performers-other-user@example.test');
  const visit = await visitOf(f, [editorLine(f)]);
  const line = must(visit.lines[0]).id;
  await runChange(f, visit.sessionId, line, performersInput({ performers: [{ employee_id: must(f.employees[0]) }] }), { userId: f.ownerId });
  await f.linkEmployee(f.editorEmployee, null);
  await f.linkEmployee(f.editorEmployee, other);
  try {
    await runChange(f, visit.sessionId, line, performersInput({ expected_revision: 2, performers: [{ employee_id: f.editorEmployee }] }), { userId: f.ownerId });
    const key = ids.newId();
    const before = await changeQuiet(f, visit.sessionId, line, key);
    await expect(runChange(f, visit.sessionId, line, performersInput({ expected_revision: 3, performers: [{ employee_id: must(f.employees[1]) }] }), { key })).rejects.toMatchObject({ code: 'SESSION_PERFORMER_SELF_FORBIDDEN' });
    expect(await changeQuiet(f, visit.sessionId, line, key)).toEqual({ ...before, keys: 0 });
  } finally {
    await f.linkEmployee(f.editorEmployee, null);
    await f.linkEmployee(f.editorEmployee, f.editorId);
  }
});

it('PC-10b a removed performer linked to the changer later still forbids her', async () => {
  const removed = must(f.employees[0]);
  const visit = await visitOf(f);
  const line = must(visit.lines[0]).id;
  await runChange(f, visit.sessionId, line, performersInput({ performers: [{ employee_id: must(f.employees[1]) }] }), { userId: f.ownerId });
  await f.linkEmployee(f.editorEmployee, null);
  await f.linkEmployee(removed, f.editorId);
  try {
    const key = ids.newId();
    const before = await changeQuiet(f, visit.sessionId, line, key);
    await expect(runChange(f, visit.sessionId, line, performersInput({ expected_revision: 2, performers: [{ employee_id: must(f.employees[1]) }] }), { key })).rejects.toMatchObject({ code: 'SESSION_PERFORMER_SELF_FORBIDDEN' });
    expect(await changeQuiet(f, visit.sessionId, line, key)).toEqual({ ...before, keys: 0 });
  } finally {
    await f.linkEmployee(removed, null);
    await f.linkEmployee(f.editorEmployee, f.editorId);
  }
});

it('PC-11 one of two performers linked to the changer is enough to refuse', async () => {
  await f.linkEmployee(f.editorEmployee, null);
  await f.linkEmployee(must(f.employees[1]), f.editorId);
  try {
    const visit = await visitOf(f, [pairLine(f)]);
    const line = must(visit.lines[0]).id;
    const key = ids.newId();
    await expect(runChange(f, visit.sessionId, line, performersInput({ performers: [{ employee_id: must(f.employees[0]) }] }), { key })).rejects.toMatchObject({ code: 'SESSION_PERFORMER_SELF_FORBIDDEN' });
    expect(await changeQuiet(f, visit.sessionId, line, key)).toEqual({ headers: 0, audits: 0, events: 0, keys: 0 });
  } finally {
    await f.linkEmployee(must(f.employees[1]), null);
    await f.linkEmployee(f.editorEmployee, f.editorId);
  }
});

it('PC-12 a line without an identity snapshot is refused for everybody', async () => {
  const visit = await visitOf(f);
  const line = must(visit.lines[0]).id;
  await f.snapshotPerformers(line, [{ employee_id: must(f.employees[0]), linked_user_id: null, linked_user_snapshotted: false }]);
  const key = ids.newId();
  await expect(runChange(f, visit.sessionId, line, performersInput({ performers: [{ employee_id: must(f.employees[1]) }] }), { key })).rejects.toMatchObject({ code: 'SESSION_LINE_IDENTITY_UNKNOWN' });
  expect(await changeQuiet(f, visit.sessionId, line, key)).toEqual({ headers: 0, audits: 0, events: 0, keys: 0 });
  const ownerKey = ids.newId();
  await expect(runChange(f, visit.sessionId, line, performersInput({ performers: [{ employee_id: must(f.employees[1]) }] }), { userId: f.ownerId, key: ownerKey })).rejects.toMatchObject({ code: 'SESSION_LINE_IDENTITY_UNKNOWN' });
  expect(await changeQuiet(f, visit.sessionId, line, ownerKey)).toEqual({ headers: 0, audits: 0, events: 0, keys: 0 });
});

it('several eligible memberships need an explicit changer, and a foreign one is forbidden', async () => {
  const visit = await visitOf(f);
  const line = must(visit.lines[0]).id;
  await expect(runChange(f, visit.sessionId, line, performersInput({ changer_membership_id: ids.newId() }))).rejects.toMatchObject({ code: 'FORBIDDEN' });
  const extra = ids.newId();
  try {
    await f.h.owner`INSERT INTO memberships(company_id,id,user_id,role_id,role_owner_key,scope_type,scope_id,limit_bps,starts_at)
      SELECT ${f.company},${extra},${f.editorId},role_id,role_owner_key,'COMPANY',${f.company},2000,'2026-01-01T00:00:00Z'
      FROM memberships WHERE company_id=${f.company} AND id=${f.editorMembership}`;
    const ambiguous = await runChange(f, visit.sessionId, line, performersInput({ performers: [{ employee_id: must(f.employees[1]) }] })).then(() => null, (error: unknown) => error);
    expect(ambiguous).toMatchObject({ code: 'SESSION_CHANGER_MEMBERSHIP_REQUIRED' });
    const onError = (ambiguous as { details: { changer_membership_ids: string[] } }).details.changer_membership_ids;
    expect([...onError].sort()).toEqual([extra, f.editorMembership].sort());
    expect(await runChange(f, visit.sessionId, line, performersInput({ performers: [{ employee_id: must(f.employees[1]) }], changer_membership_id: f.editorMembership }))).toMatchObject({ line: { revision: 2 } });
  } finally {
    await f.h.owner`UPDATE memberships SET ends_at='2026-10-14T00:00:00Z' WHERE company_id=${f.company} AND id=${extra}`;
  }
});

function pairLine(fixture: PerformersFixture) {
  return {
    ...fixture.line(must(fixture.services[0]), '25.000', '0.000'),
    performers: [{ employee_id: must(fixture.employees[0]) }, { employee_id: must(fixture.employees[1]) }],
  };
}

function editorLine(fixture: PerformersFixture) {
  return {
    ...fixture.line(must(fixture.services[0]), '25.000', '0.000'),
    performers: [{ employee_id: fixture.editorEmployee }],
  };
}
