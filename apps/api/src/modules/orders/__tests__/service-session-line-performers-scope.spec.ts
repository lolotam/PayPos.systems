import { afterAll, beforeAll, expect, it } from 'vitest';
import { holdVisit, waitForAdvisory } from '../../../../test/session-tips.fixture.ts';
import { ids, must } from './session.fixture.ts';
import { editBody, runEdit } from './line-edit.helpers.ts';
import {
  changeQuiet,
  changeRows,
  createEmployee,
  newOperatorUser,
  performersFixture,
  performersInput,
  runChange,
  scopedMember,
  secondBranchOfBusiness,
  visitOf,
  type PerformersFixture,
} from './line-performers.helpers.ts';

let f: PerformersFixture;
beforeAll(async () => { f = await performersFixture(); });
afterAll(async () => { await f?.close(); });

it('FR-011 a line of another visit of the same branch is forbidden for an authorised caller', async () => {
  const general = await scopedMember(f, 'performers-scope-general@example.test', 'general_manager', 'COMPANY', f.company);
  const visit = await visitOf(f);
  const other = await visitOf(f);
  const key = ids.newId();
  await expect(runChange(f, visit.sessionId, must(other.lines[0]).id, performersInput({ performers: [{ employee_id: must(f.employees[1]) }] }), { userId: general.userId, key })).rejects.toMatchObject({ code: 'FORBIDDEN' });
  expect(await changeQuiet(f, visit.sessionId, must(other.lines[0]).id, key)).toEqual({ headers: 0, audits: 0, events: 0, keys: 0 });
});

it('FR-011 the right line under another branch of the same business is forbidden for an authorised caller', async () => {
  const general = await scopedMember(f, 'performers-scope-branch@example.test', 'general_manager', 'COMPANY', f.company);
  const branch = await secondBranchOfBusiness(f);
  const visit = await visitOf(f);
  const line = must(visit.lines[0]).id;
  const key = ids.newId();
  await expect(runChange(f, visit.sessionId, line, performersInput({ performers: [{ employee_id: must(f.employees[1]) }] }), { userId: general.userId, branchId: branch, key })).rejects.toMatchObject({ code: 'FORBIDDEN' });
  expect(await changeQuiet(f, visit.sessionId, line, key)).toEqual({ headers: 0, audits: 0, events: 0, keys: 0 });
});

it('FR-011 another company is forbidden for a caller authorised there', async () => {
  const owner = await newOperatorUser(f, 'performers-other-company@example.test');
  const membership = ids.newId();
  await f.h.owner`INSERT INTO memberships(company_id,id,user_id,role_id,role_owner_key,scope_type,scope_id,limit_bps,starts_at)
    SELECT ${f.otherCompany},${membership},${owner},r.id,'global','COMPANY',${f.otherCompany},NULL,'2026-01-01T00:00:00Z'
    FROM roles r WHERE r.company_id IS NULL AND r.code='owner'`;
  const visit = await visitOf(f);
  const line = must(visit.lines[0]).id;
  const key = ids.newId();
  await expect(runChange(f, visit.sessionId, line, performersInput({ performers: [{ employee_id: must(f.employees[1]) }] }), { userId: owner, companyId: f.otherCompany, businessId: f.foreignBusiness, branchId: f.foreignBranch, key })).rejects.toMatchObject({ code: 'FORBIDDEN' });
  expect(await changeQuiet(f, visit.sessionId, line, key)).toEqual({ headers: 0, audits: 0, events: 0, keys: 0 });
});

it('FR-004 a set of more than eighty performers is locked in batches and refused by the identity first', async () => {
  const created: string[] = [];
  for (let index = 0; index < 81; index += 1) {
    created.push(await createEmployee(f));
  }
  const last = must(created[80]);
  await f.linkEmployee(f.editorEmployee, null);
  await f.linkEmployee(last, f.editorId);
  try {
    const visit = await visitOf(f);
    const line = must(visit.lines[0]).id;
    const key = ids.newId();
    await expect(runChange(f, visit.sessionId, line, performersInput({
      performers: created.map((employeeId) => ({ employee_id: employeeId, share_bps: 1 })),
    }), { key })).rejects.toMatchObject({ code: 'SESSION_PERFORMER_SELF_FORBIDDEN' });
    expect(await changeQuiet(f, visit.sessionId, line, key)).toEqual({ headers: 0, audits: 0, events: 0, keys: 0 });
  } finally {
    await f.linkEmployee(last, null);
    await f.linkEmployee(f.editorEmployee, f.editorId);
  }
});

it('FR-008 a performer of another business of the same company is not eligible', async () => {
  const stranger = await createEmployee(f, { business_id: f.foreignBusiness, branch_id: f.foreignBranch });
  const visit = await visitOf(f);
  const line = must(visit.lines[0]).id;
  const key = ids.newId();
  const error = await runChange(f, visit.sessionId, line, performersInput({
    performers: [{ employee_id: must(f.employees[0]), share_bps: 5000 }, { employee_id: stranger, share_bps: 5000 }],
  }), { key }).then(() => null, (caught: unknown) => caught);
  expect(error).toMatchObject({ code: 'SESSION_PERFORMER_NOT_ELIGIBLE', details: { employee_ids: [stranger] } });
  expect(await changeQuiet(f, visit.sessionId, line, key)).toEqual({ headers: 0, audits: 0, events: 0, keys: 0 });
});

it('FR-008 a performer of another company is not eligible', async () => {
  const stranger = await createEmployee(f, { company_id: f.otherCompany, business_id: f.foreignBusiness, branch_id: f.foreignBranch });
  const visit = await visitOf(f);
  const line = must(visit.lines[0]).id;
  const key = ids.newId();
  const error = await runChange(f, visit.sessionId, line, performersInput({
    performers: [{ employee_id: must(f.employees[0]), share_bps: 5000 }, { employee_id: stranger, share_bps: 5000 }],
  }), { key }).then(() => null, (caught: unknown) => caught);
  expect(error).toMatchObject({ code: 'SESSION_PERFORMER_NOT_ELIGIBLE', details: { employee_ids: [stranger] } });
  expect(await changeQuiet(f, visit.sessionId, line, key)).toEqual({ headers: 0, audits: 0, events: 0, keys: 0 });
});

it('PC-23 a change racing a cancel leaves one winner and the loser is stale', async () => {
  const visit = await visitOf(f);
  const line = must(visit.lines[0]).id;
  const held = await holdVisit(f, visit.sessionId);
  const cancel = f.cancel.execute({
    ...f.context(ids.newId(), f.editorId),
    sessionId: visit.sessionId,
    lineId: line,
    input: { reason: 'Synthetic cancel reason', expected_revision: 1 },
  });
  const change = runChange(f, visit.sessionId, line, performersInput({ performers: [{ employee_id: must(f.employees[1]) }] }), { key: ids.newId() });
  try { expect(await waitForAdvisory(f, held.pid, 2)).toBeGreaterThanOrEqual(2); }
  finally { await held.release(); }
  const outcomes = await Promise.allSettled([cancel, change]);
  expect(outcomes.filter((item) => item.status === 'fulfilled')).toHaveLength(1);
  const loser = outcomes.find((item) => item.status === 'rejected');
  if (loser?.status !== 'rejected') throw new Error('expected one stale refusal');
  expect(loser.reason).toMatchObject({ code: 'SESSION_LINE_REVISION_STALE', details: { current_revision: 2 } });
  const [cancellations] = await f.h.owner`SELECT 1 FROM service_line_cancellations WHERE company_id=${f.company} AND line_id=${line}`;
  const saved = await changeRows(f, visit.sessionId, line);
  expect(saved.line).toMatchObject({ revision: 2 });
  expect(saved.headers.length + cancellations.length).toBe(1);
  expect(saved.audits).toHaveLength(saved.headers.length);
  expect(saved.events).toHaveLength(1);
});

it('PC-23 a change racing a price edit leaves one winner and the loser is stale', async () => {
  const visit = await visitOf(f);
  const line = must(visit.lines[0]).id;
  const held = await holdVisit(f, visit.sessionId);
  const edit = runEdit(f, visit.sessionId, line, editBody({ price: '20.000', discount: { kind: 'AMOUNT', amount: '0.000' } }));
  const change = runChange(f, visit.sessionId, line, performersInput({ performers: [{ employee_id: must(f.employees[1]) }] }), { key: ids.newId() });
  try { expect(await waitForAdvisory(f, held.pid, 2)).toBeGreaterThanOrEqual(2); }
  finally { await held.release(); }
  const outcomes = await Promise.allSettled([edit, change]);
  expect(outcomes.filter((item) => item.status === 'fulfilled')).toHaveLength(1);
  const loser = outcomes.find((item) => item.status === 'rejected');
  if (loser?.status !== 'rejected') throw new Error('expected one stale refusal');
  expect(loser.reason).toMatchObject({ code: 'SESSION_LINE_REVISION_STALE', details: { current_revision: 2 } });
  const [edits] = await f.h.owner`SELECT 1 FROM service_line_edits WHERE company_id=${f.company} AND line_id=${line}`;
  const saved = await changeRows(f, visit.sessionId, line);
  expect(saved.line).toMatchObject({ revision: 2 });
  expect(saved.headers.length + edits.length).toBe(1);
  expect(saved.audits).toHaveLength(saved.headers.length);
  expect(saved.events).toHaveLength(1);
});

it('PC-23 an append racing a change on the same visit lets both through', async () => {
  const visit = await visitOf(f);
  const line = must(visit.lines[0]).id;
  const held = await holdVisit(f, visit.sessionId);
  const append = f.append.execute({
    ...f.context(ids.newId()),
    sessionId: visit.sessionId,
    input: { lines: [f.line(must(f.services[1]), '7.125', '0.000')] },
  });
  const change = runChange(f, visit.sessionId, line, performersInput({ performers: [{ employee_id: must(f.employees[1]) }] }), { key: ids.newId() });
  try { expect(await waitForAdvisory(f, held.pid, 2)).toBeGreaterThanOrEqual(2); }
  finally { await held.release(); }
  const outcomes = await Promise.allSettled([append, change]);
  expect(outcomes.every((item) => item.status === 'fulfilled')).toBe(true);
  const saved = await changeRows(f, visit.sessionId, line);
  expect(saved.line).toMatchObject({ revision: 2, status: 'ACTIVE' });
  expect(saved.live.map((row) => row['employee_id'])).toEqual([must(f.employees[1])]);
  const appended = await f.h.owner`SELECT 1 FROM service_lines WHERE company_id=${f.company} AND session_id=${visit.sessionId}`;
  expect(appended).toHaveLength(2);
});
