import { afterAll, beforeAll, expect, it } from 'vitest';
import { appendServiceSessionLinesResponse, editServiceLineResponseFull, editServiceLineResponseNarrow, recordServiceSessionResponse } from '@pospay/contracts';
import { serviceSessionErrors } from '@pospay/i18n';
import { origin, paired } from '../../../../test/staff-otp-harness.ts';
import { ids, must, editFixture, type EditFixture } from './session.fixture.ts';

let f: EditFixture;
let narrowCookie = '';
beforeAll(async () => { f = await editFixture(); narrowCookie = await readLessEditor(); });
afterAll(async () => { await f?.close(); });

const HISTORY = ['previous_price', 'previous_discount', 'previous_net', 'changed_at', 'changed_by', 'changed_by_membership_id', 'editor_role', 'editor_name_ar', 'editor_name_en', 'editor_label_ar', 'editor_label_en', 'reason'];
const editInput = (expected = 1, reason = 'Synthetic edit reason') => ({ price: '26.000', discount: { kind: 'AMOUNT' as const, amount: '0.000' }, reason, expected_revision: expected });
const editUrl = (sessionId: string, lineId: string, branch = f.branch, business = f.business) =>
  `/v1/businesses/${business}/branches/${branch}/service-sessions/${sessionId}/lines/${lineId}`;
const patch = (url: string, body: object, cookie = f.editorCookie, key = ids.newId(), company = f.company) =>
  f.h.send('PATCH', url, { cookie, company, key, body });

it('LE-14/LE-16 a reader gets the line and visit total, never history, and record/append omit edited', async () => {
  const reason = `sentinel-${ids.newId()}`;
  const recordKey = ids.newId();
  const recorded = await f.h.send('POST', f.base, { cookie: f.ownerCookie, company: f.company, key: recordKey, body: { customer_id: f.customer, lines: [f.line()] } });
  const session = recordServiceSessionResponse.parse(recorded.body).session;
  const line = must(session.lines[0]);
  expect(line.edited === true).toBe(false);
  const appended = appendServiceSessionLinesResponse.parse((await f.h.send('POST', `${f.base}/${session.id}/lines`, { cookie: f.ownerCookie, company: f.company, key: ids.newId(), body: { lines: [f.line(must(f.services[3]), '15.000')] } })).body);
  expect(appended.added_lines.every((item) => item.edited !== true)).toBe(true);
  expect(appended.session.lines.every((item) => item.edited !== true)).toBe(true);
  const url = editUrl(session.id, line.id);
  const key = ids.newId();
  const first = await patch(url, editInput(1, reason), f.editorCookie, key);
  const replay = await patch(url, editInput(1, reason), f.editorCookie, key);
  expect(first.status).toBe(200);
  expect(replay.body).toEqual(first.body);
  const parsed = editServiceLineResponseFull.parse(first.body);
  expect(parsed.line.edited).toBe(true);
  expect(Object.keys(parsed.session).sort()).toEqual(['id', 'total_net']);
  expect(JSON.stringify(first.body)).not.toContain(reason);
  for (const field of HISTORY) expect(nestedHas(first.body, field)).toBe(false);
  const recordReplay = await f.h.send('POST', f.base, { cookie: f.ownerCookie, company: f.company, key: recordKey, body: { customer_id: f.customer, lines: [f.line()] } });
  expect(recordReplay.body).toEqual(recorded.body);
  expect(JSON.stringify(recordReplay.body)).not.toContain(reason);
});

it('LE-14 a caller with edit and without branch read gets only saved and edited, including the replay', async () => {
  const visit = await savedVisit();
  const reason = `sentinel-${ids.newId()}`;
  const key = ids.newId();
  const url = editUrl(visit.sessionId, visit.lineId);
  const first = await patch(url, editInput(1, reason), narrowCookie, key);
  const replay = await patch(url, editInput(1, reason), narrowCookie, key);
  expect(first.status).toBe(200);
  expect(editServiceLineResponseNarrow.parse(first.body)).toEqual({ saved: true, edited: true });
  expect(replay.body).toEqual(first.body);
  expect(Object.keys(first.body as object).sort()).toEqual(['edited', 'saved']);
  expect(JSON.stringify(first.body)).not.toMatch(/\d\.\d{3}/);
  expect(JSON.stringify(first.body)).not.toContain(reason);
  for (const field of [...HISTORY, 'price', 'discount', 'net', 'total_net', 'revision', 'list_price']) expect(nestedHas(first.body, field)).toBe(false);
});

it('LE-18b a read-less caller gets 409 current_revision with no money, then saves with that revision', async () => {
  const visit = await savedVisit();
  const url = editUrl(visit.sessionId, visit.lineId);
  const stale = await patch(url, editInput(9), narrowCookie);
  expect(stale.status).toBe(409);
  expect(stale.body).toMatchObject({ code: 'SESSION_LINE_REVISION_STALE', ...serviceSessionErrors.SESSION_LINE_REVISION_STALE, details: { current_revision: 1 } });
  expect(Object.keys(stale.body['details'] as object)).toEqual(['current_revision']);
  expect(JSON.stringify(stale.body['details'])).not.toMatch(/\d\.\d{3}/);
  const saved = await patch(url, editInput(1), narrowCookie);
  expect(saved.status).toBe(200);
  expect(saved.body).toEqual({ saved: true, edited: true });
  const replay = await patch(url, editInput(1), narrowCookie, ids.newId());
  expect(replay.status).toBe(409);
});

it('route refuses a missing key, a device, the wrong permission, a disabled feature, a bad body, and a foreign line', async () => {
  const visit = await savedVisit();
  const other = await savedVisit();
  const url = editUrl(visit.sessionId, visit.lineId);
  const missing = await f.h.send('PATCH', url, { cookie: f.editorCookie, company: f.company, body: editInput() });
  expect(missing.status).toBe(400);
  expect(missing.body['code']).toBe('IDEMPOTENCY_KEY_REQUIRED');
  const device = await paired(f.h, f.ownerCookie, f.company, f.branch);
  const deviceReply = await f.h.app.inject({ method: 'PATCH', url, headers: { authorization: `Device ${device.token}`, origin, 'x-company-id': f.company, 'idempotency-key': ids.newId() }, payload: editInput() });
  expect(deviceReply.statusCode).toBe(403);
  expect(deviceReply.json().code).toBe('FORBIDDEN');
  expect((await patch(url, editInput(), f.cookie)).status).toBe(403);
  const blank = await patch(url, { price: '26.000', discount: { kind: 'AMOUNT', amount: '0.000' }, expected_revision: 1 });
  expect(blank.status).toBe(422);
  expect(blank.body).toMatchObject({ code: 'SESSION_EDIT_REASON_INVALID', ...serviceSessionErrors.SESSION_EDIT_REASON_INVALID });
  expect((await patch(url, { ...editInput(), net: '26.000' })).body['code']).toBe('VALIDATION_FAILED');
  expect((await patch(url, { ...editInput(), price: '26.00' })).status).toBe(400);
  const over = await patch(url, { ...editInput(), price: '25.000', discount: { kind: 'AMOUNT', amount: '6.000' } });
  expect(over.status).toBe(422);
  expect(over.body['code']).toBe('SESSION_DISCOUNT_ABOVE_LIMIT');
  await f.h.owner`INSERT INTO company_feature_overrides(company_id,flag,enabled,reason,set_by) VALUES(${f.company},'orders',false,'Synthetic edit feature',${f.ownerId})`;
  try {
    const disabled = await patch(url, editInput());
    expect(disabled.status).toBe(403);
    expect(disabled.body['code']).toBe('FEATURE_DISABLED');
  }
  finally { await f.h.owner`DELETE FROM company_feature_overrides WHERE company_id=${f.company} AND flag='orders'`; }
  const foreign = [
    await patch(editUrl(visit.sessionId, ids.newId()), editInput()),
    await patch(editUrl(visit.sessionId, other.lineId), editInput()),
    await patch(editUrl(visit.sessionId, visit.lineId, f.secondBranch), editInput(), f.ownerCookie),
    await patch(editUrl(visit.sessionId, visit.lineId, f.foreignBranch, f.foreignBusiness), editInput(), f.ownerCookie, ids.newId(), f.company),
    await patch(url, editInput(), f.ownerCookie, ids.newId(), f.otherCompany),
  ];
  expect(foreign.every((reply) => reply.status === 403 && reply.body['code'] === 'FORBIDDEN')).toBe(true);
  expect(JSON.stringify(foreign[0]?.body)).toBe(JSON.stringify(foreign[1]?.body));
});

async function savedVisit() {
  const response = await f.h.send('POST', f.base, { cookie: f.ownerCookie, company: f.company, key: ids.newId(), body: { customer_id: f.customer, lines: [f.line()] } });
  expect(response.status).toBe(201);
  const session = recordServiceSessionResponse.parse(response.body).session;
  const line = must(session.lines[0]);
  return { sessionId: session.id, lineId: line.id };
}

async function readLessEditor() {
  const cookie = await f.h.signedInOperator('session-readless-editor@example.test');
  const users = await f.h.owner`SELECT id FROM "user" WHERE email='session-readless-editor@example.test'`;
  const userId = must(users[0])['id'] as string;
  const role = ids.newId();
  const membership = ids.newId();
  await f.h.owner`INSERT INTO roles(id,company_id,code,name_en) VALUES(${role},${f.company},'line_editor','Synthetic editor')`;
  await f.h.owner`INSERT INTO role_permissions(role_id,role_owner_key,company_id,permission_code) VALUES(${role},${f.company},${f.company},'edit:service-line-prices:branch')`;
  await f.h.owner`INSERT INTO memberships(company_id,id,user_id,role_id,role_owner_key,scope_type,scope_id,limit_bps,starts_at)
    VALUES(${f.company},${membership},${userId},${role},${f.company},'BRANCH',${f.branch},10000,'2026-01-01T00:00:00Z')`;
  return cookie;
}

function nestedHas(value: unknown, key: string): boolean {
  if (Array.isArray(value)) return value.some((item) => nestedHas(item, key));
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return key in record || Object.values(record).some((child) => nestedHas(child, key));
  }
  return false;
}
