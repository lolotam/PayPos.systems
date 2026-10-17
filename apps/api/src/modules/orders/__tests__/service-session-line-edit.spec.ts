import { afterAll, beforeAll, expect, it } from 'vitest';
import { serviceLineChanged } from '@pospay/contracts';
import { AT, ids, must, editFixture, type EditFixture } from './session.fixture.ts';
import { editBody, editRows, quietCounts, recorded, runEdit } from './line-edit.helpers.ts';

let f: EditFixture;
beforeAll(async () => { f = await editFixture(); });
afterAll(async () => { await f?.close(); });

it('LE-01/02 a manager discount writes one revision, history, audit, and editor event', async () => {
  const visit = await recorded(f);
  const result = await runEdit(f, visit.sessionId, visit.lineId, editBody());
  expect(result).toMatchObject({ line: { revision: 2, price: '25.000', discount: '5.000', net: '20.000', edited: true, recorded_by: f.userId, limit_source: 'PERSON', limit_bps_applied: 2000 }, session: { id: visit.sessionId, total_net: '20.000' } });
  const saved = await editRows(f, visit.sessionId, visit.lineId);
  expect(saved.line).toMatchObject({ revision: 2, price: '25.000', discount: '5.000', net: '20.000', limit_source: 'PERSON', limit_bps_applied: 2000, recorded_by: f.userId, effective_discount_bps: 2000 });
  expect(saved.edits).toHaveLength(1);
  expect(saved.edits[0]).toMatchObject({ revision: 2, previous_revision: 1, previous_price: '25.000', previous_discount: '2.500', previous_net: '22.500', new_price: '25.000', new_discount: '5.000', new_net: '20.000', previous_effective_discount_bps: 1000, previous_limit_source: 'PERSON', previous_limit_bps_applied: 1000, new_effective_discount_bps: 2000, new_limit_source: 'PERSON', new_limit_bps_applied: 2000, editor_name_ar: 'ليلى', editor_name_en: 'Layla Editor', editor_role: 'branch_manager', editor_role_is_system: true, editor_role_name_en: 'Branch Manager', editor_role_name_ar: null, changed_by: f.editorId, changed_by_membership_id: f.editorMembership });
  expect(saved.audits).toHaveLength(1);
  expect(saved.events).toHaveLength(1);
  const event = serviceLineChanged.parse(must(saved.events[0])['payload']);
  expect(event.change?.changed_by).toBe(f.editorId);
  expect(event.recorded_by).toBe(f.userId);
  expect(event.revision).toBe(2);
  expect(event.change?.previous).toEqual({ revision: 1, price: '25.000', discount: '2.500', net: '22.500' });
});

it('LE-03/04 the owner edits above and below list with an unlimited limit and null names', async () => {
  const visit = await recorded(f, '25.000', '0.000');
  const above = await runEdit(f, visit.sessionId, visit.lineId, editBody({ price: '27.000', discount: { kind: 'AMOUNT', amount: '0.000' } }), { userId: f.ownerId });
  expect(above).toMatchObject({ line: { price: '27.000', discount: '0.000', net: '27.000', revision: 2, limit_source: 'OWNER', limit_bps_applied: null, recorded_by: f.userId } });
  const below = await runEdit(f, visit.sessionId, visit.lineId, editBody({ price: '15.000', discount: { kind: 'AMOUNT', amount: '0.000' }, expected_revision: 2 }), { userId: f.ownerId });
  expect(below).toMatchObject({ line: { price: '15.000', net: '15.000', revision: 3, limit_source: 'OWNER', limit_bps_applied: null } });
  const [row] = await f.h.owner`SELECT editor_name_ar,editor_name_en,editor_role,editor_role_is_system,editor_role_name_en,new_limit_source,new_limit_bps_applied FROM service_line_edits WHERE company_id=${f.company} AND line_id=${visit.lineId} AND revision=3`;
  expect(row).toMatchObject({ editor_name_ar: null, editor_name_en: null, editor_role: 'owner', editor_role_is_system: true, editor_role_name_en: 'Owner', new_limit_source: 'OWNER', new_limit_bps_applied: null });
});

it('LE-05 over the editor limit writes no outbox, history, audit, or idempotency row', async () => {
  const visit = await recorded(f);
  const key = ids.newId();
  await expect(runEdit(f, visit.sessionId, visit.lineId, editBody({ discount: { kind: 'AMOUNT', amount: '5.500' } }), { key })).rejects.toMatchObject({
    code: 'SESSION_DISCOUNT_ABOVE_LIMIT', details: { minimum_net: '20.000', max_discount_amount: '5.000', limit_bps_applied: 2000 },
  });
  expect(await quietCounts(f, visit.sessionId, visit.lineId, key)).toEqual({ edits: 0, audits: 0, events: 0, keys: 0 });
  const [line] = await f.h.owner`SELECT revision,discount::text FROM service_lines WHERE company_id=${f.company} AND id=${visit.lineId}`;
  expect(line).toMatchObject({ revision: 1, discount: '2.500' });
});

it('a stale expected revision returns the current revision and no money', async () => {
  const visit = await recorded(f);
  const error = await runEdit(f, visit.sessionId, visit.lineId, editBody({ expected_revision: 4 })).then(() => null, (caught: unknown) => caught);
  expect(error).toMatchObject({ code: 'SESSION_LINE_REVISION_STALE', details: { current_revision: 1 } });
  expect(Object.keys((error as { details: object }).details)).toEqual(['current_revision']);
  expect(JSON.stringify((error as { details: object }).details)).not.toMatch(/\d\.\d{3}/);
});

it('an unchanged price and discount writes nothing', async () => {
  const visit = await recorded(f);
  const key = ids.newId();
  await expect(runEdit(f, visit.sessionId, visit.lineId, editBody({ discount: { kind: 'AMOUNT', amount: '2.500' } }), { key })).rejects.toThrow('SESSION_EDIT_NO_CHANGE');
  expect(await quietCounts(f, visit.sessionId, visit.lineId, key)).toEqual({ edits: 0, audits: 0, events: 0, keys: 0 });
});

it('a cancelled line is not editable and writes nothing', async () => {
  const visit = await recorded(f, '25.000', '0.000');
  const key = ids.newId();
  await f.h.owner`UPDATE service_lines SET status='CANCELLED' WHERE company_id=${f.company} AND id=${visit.lineId}`;
  await expect(runEdit(f, visit.sessionId, visit.lineId, editBody({ price: '26.000', discount: { kind: 'AMOUNT', amount: '0.000' } }), { key })).rejects.toThrow('SESSION_LINE_NOT_EDITABLE');
  expect(await quietCounts(f, visit.sessionId, visit.lineId, key)).toEqual({ edits: 0, audits: 0, events: 0, keys: 0 });
});

it('an edit outside the recording window is refused and the clock is restored', async () => {
  const visit = await recorded(f, '25.000', '0.000');
  f.setAt(new Date('2026-12-01T00:00:00Z'));
  try {
    await expect(runEdit(f, visit.sessionId, visit.lineId, editBody({ price: '26.000', discount: { kind: 'AMOUNT', amount: '0.000' } }))).rejects.toThrow('SESSION_TIME_TOO_OLD');
  } finally { f.setAt(AT); }
});

it('a visit total above the money maximum is refused', async () => {
  const big = await f.create.execute({ ...f.context(), input: f.body([f.line(must(f.services[0]), '99999999998.999', '0.000')]) });
  const added = await f.append.execute({ ...f.context(ids.newId(), f.ownerId), sessionId: big.session.id, input: { lines: [f.line(must(f.services[0]), '1.000', '0.000')] } });
  const small = must(added.added_lines[0]);
  await expect(runEdit(f, big.session.id, small.id, editBody({ price: '1.001', discount: { kind: 'AMOUNT', amount: '0.000' } }), { userId: f.ownerId })).rejects.toThrow('SESSION_TOTAL_TOO_LARGE');
});

it('missing and foreign lines share one forbidden error and write nothing', async () => {
  const visit = await recorded(f);
  const other = await recorded(f);
  const before = await editFootprint(f);
  const errors = await Promise.all([
    refused(f, visit.sessionId, ids.newId()),
    refused(f, visit.sessionId, other.lineId),
    refused(f, visit.sessionId, visit.lineId, { branchId: f.secondBranch }),
    refused(f, visit.sessionId, visit.lineId, { companyId: f.otherCompany, businessId: f.foreignBusiness, branchId: f.foreignBranch }),
  ]);
  const message = messageOf(errors[0]);
  for (const error of errors) expect(error).toMatchObject({ code: 'FORBIDDEN', message });
  expect(await editFootprint(f)).toEqual(before);
});

it('refuses the edit when the orders feature is off and writes nothing', async () => {
  const visit = await recorded(f);
  const key = ids.newId();
  await f.h.owner`INSERT INTO company_feature_overrides(company_id,flag,enabled,reason,set_by) VALUES(${f.company},'orders',false,'Synthetic feature',${f.ownerId})`;
  try {
    await expect(runEdit(f, visit.sessionId, visit.lineId, editBody(), { key })).rejects.toThrow('FEATURE_DISABLED');
    expect(await quietCounts(f, visit.sessionId, visit.lineId, key)).toEqual({ edits: 0, audits: 0, events: 0, keys: 0 });
  } finally {
    await f.h.owner`DELETE FROM company_feature_overrides WHERE company_id=${f.company} AND flag='orders'`;
  }
});

async function refused(f: EditFixture, sessionId: string, lineId: string, patch: { branchId?: string; companyId?: string; businessId?: string } = {}) {
  return f.edit.execute({ ...f.context(), ...patch, sessionId, lineId, input: editBody() }).then(() => null, (caught: unknown) => caught);
}

function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message;
  throw new Error('Expected a forbidden error');
}

async function editFootprint(f: EditFixture) {
  const [row] = await f.h.owner`SELECT
    (SELECT count(*)::int FROM service_line_edits WHERE company_id IN (${f.company},${f.otherCompany})) AS edits,
    (SELECT count(*)::int FROM audit_log WHERE company_id IN (${f.company},${f.otherCompany}) AND action='service_line.price_discount_edited') AS audits,
    (SELECT count(*)::int FROM outbox WHERE company_id IN (${f.company},${f.otherCompany}) AND event_type='ServiceLineChanged') AS events,
    (SELECT count(*)::int FROM idempotency_keys WHERE operation='edit-service-line-price' AND company_id IN (${f.company},${f.otherCompany})) AS keys`;
  return row;
}
