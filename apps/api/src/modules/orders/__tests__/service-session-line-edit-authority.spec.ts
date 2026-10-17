import { employeeNameMatchKey } from '@pospay/domain';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { AT, ids, must, sessionFixture, type SessionFixture } from './session.fixture.ts';
import { EDIT_REASON, editBody, editRows, quietCounts, recorded, runEdit } from './line-edit.helpers.ts';

let f: SessionFixture;
beforeAll(async () => { f = await sessionFixture(); });
afterAll(async () => { await f?.close(); });
const amount = (value: string) => ({ kind: 'AMOUNT' as const, amount: value });

it('LE-17 the same key and body replay without a second write, and a changed body is reused', async () => {
  const visit = await recorded(f);
  const key = ids.newId();
  const fingerprint = 'a'.repeat(64);
  const input = editBody();
  const first = await runEdit(f, visit.sessionId, visit.lineId, input, { key, fingerprint });
  const replay = await runEdit(f, visit.sessionId, visit.lineId, input, { key, fingerprint });
  expect(replay).toEqual(first);
  expect(await editRows(f, visit.sessionId, visit.lineId)).toMatchObject({ edits: [expect.anything()], events: [expect.anything()] });
  expect((await editRows(f, visit.sessionId, visit.lineId)).events).toHaveLength(1);
  await expect(runEdit(f, visit.sessionId, visit.lineId, editBody({ price: '26.000', discount: amount('0.000') }), { key, fingerprint: 'b'.repeat(64) })).rejects.toThrow('IDEMPOTENCY_KEY_REUSED');
});

it('LE-18 exactly one of two racing editors wins and the other writes nothing', async () => {
  const visit = await recorded(f, '25.000', '0.000');
  const editorKey = ids.newId();
  const ownerKey = ids.newId();
  const [editor, owner] = await Promise.allSettled([
    runEdit(f, visit.sessionId, visit.lineId, editBody({ price: '27.000', discount: amount('0.000') }), { key: editorKey, fingerprint: 'c'.repeat(64) }),
    runEdit(f, visit.sessionId, visit.lineId, editBody({ price: '26.000', discount: amount('0.000') }), { userId: f.ownerId, key: ownerKey, fingerprint: 'd'.repeat(64) }),
  ]);
  const outcomes = [editor, owner];
  expect(outcomes.filter((item) => item.status === 'fulfilled')).toHaveLength(1);
  expect(outcomes.filter((item) => item.status === 'rejected' && item.reason instanceof Error && item.reason.message === 'SESSION_LINE_REVISION_STALE')).toHaveLength(1);
  const saved = await editRows(f, visit.sessionId, visit.lineId);
  expect(saved.edits).toHaveLength(1);
  expect(saved.events).toHaveLength(1);
  const loser = editor.status === 'rejected' ? editorKey : ownerKey;
  expect(await quietCounts(f, visit.sessionId, visit.lineId, loser)).toMatchObject({ keys: 0 });
});

it('LE-19 a replay after the edit permission is denied is forbidden and writes nothing more', async () => {
  const visit = await recorded(f);
  const key = ids.newId();
  const fingerprint = 'e'.repeat(64);
  const input = editBody();
  await runEdit(f, visit.sessionId, visit.lineId, input, { key, fingerprint });
  const deny = ids.newId();
  await f.h.owner`INSERT INTO permission_overrides(company_id,id,membership_id,permission_code,effect,scope_type,scope_id,reason,granted_by)
    VALUES(${f.company},${deny},${f.editorMembership},'edit:service-line-prices:branch','DENY','BRANCH',${f.branch},'Synthetic deny',${f.ownerId})`;
  try {
    await expect(runEdit(f, visit.sessionId, visit.lineId, input, { key, fingerprint })).rejects.toThrow('FORBIDDEN');
    const saved = await editRows(f, visit.sessionId, visit.lineId);
    expect(saved.line['revision']).toBe(2);
    expect(saved.events).toHaveLength(1);
  } finally {
    await f.h.owner`DELETE FROM permission_overrides WHERE company_id=${f.company} AND id=${deny}`;
  }
});

it('two eligible memberships require an explicit choice, and a non-granting membership is not eligible', async () => {
  const extra = ids.newId();
  const cashierGrant = ids.newId();
  try {
    await f.h.owner`INSERT INTO memberships(company_id,id,user_id,role_id,role_owner_key,scope_type,scope_id,limit_bps,starts_at)
      SELECT ${f.company},${extra},${f.editorId},role_id,role_owner_key,'COMPANY',${f.company},2000,'2026-01-01T00:00:00Z' FROM memberships WHERE company_id=${f.company} AND id=${f.editorMembership}`;
    const visit = await recorded(f, '25.000', '0.000');
    const other = await recorded(f, '25.000', '0.000');
    const ambiguous = await runEdit(f, visit.sessionId, visit.lineId, editBody({ price: '26.000', discount: amount('0.000') })).then(() => null, (error: unknown) => error);
    expect(ambiguous).toMatchObject({ code: 'SESSION_EDITOR_MEMBERSHIP_REQUIRED' });
    const chosen = await runEdit(f, visit.sessionId, visit.lineId, editBody({ price: '26.000', discount: amount('0.000'), editor_membership_id: f.editorMembership }));
    expect(chosen).toMatchObject({ line: { revision: 2 } });
    await f.h.owner`INSERT INTO memberships(company_id,id,user_id,role_id,role_owner_key,scope_type,scope_id,limit_bps,starts_at)
      SELECT ${f.company},${cashierGrant},${f.userId},role_id,role_owner_key,'BRANCH',${f.branch},2000,'2026-01-01T00:00:00Z' FROM memberships WHERE company_id=${f.company} AND id=${f.editorMembership}`;
    await expect(runEdit(f, other.sessionId, other.lineId, editBody({ price: '26.000', discount: amount('0.000'), editor_membership_id: f.membership }), { userId: f.userId })).rejects.toThrow('FORBIDDEN');
    const picked = await runEdit(f, other.sessionId, other.lineId, editBody({ price: '26.000', discount: amount('0.000') }), { userId: f.userId });
    expect(picked).toMatchObject({ line: { revision: 2 } });
    const [history] = await f.h.owner`SELECT changed_by_membership_id FROM service_line_edits WHERE company_id=${f.company} AND line_id=${other.lineId}`;
    expect(history?.['changed_by_membership_id']).toBe(cashierGrant);
  } finally {
    await f.h.owner`UPDATE memberships SET ends_at='2026-10-14T00:00:00Z' WHERE company_id=${f.company} AND id IN (${extra}, ${cashierGrant})`;
  }
});

it('a caller without read access gets the narrow body on the first call and on replay', async () => {
  const role = ids.newId();
  await f.h.signedInOperator('session-narrow-editor@example.test');
  const users = await f.h.owner`SELECT id FROM "user" WHERE email='session-narrow-editor@example.test'`;
  const userId = must(users[0])['id'] as string;
  const membership = ids.newId();
  await f.h.owner`INSERT INTO roles(id,company_id,code,name_en) VALUES(${role},${f.company},'synthetic_line_editor','Synthetic editor')`;
  await f.h.owner`INSERT INTO role_permissions(role_id,role_owner_key,company_id,permission_code) VALUES(${role},${f.company},${f.company},'edit:service-line-prices:branch')`;
  await f.h.owner`INSERT INTO memberships(company_id,id,user_id,role_id,role_owner_key,scope_type,scope_id,limit_bps,starts_at)
    VALUES(${f.company},${membership},${userId},${role},${f.company},'BRANCH',${f.branch},10000,'2026-01-01T00:00:00Z')`;
  const visit = await recorded(f, '25.000', '0.000');
  const key = ids.newId();
  const fingerprint = 'f'.repeat(64);
  const input = editBody({ price: '26.000', discount: amount('0.000') });
  const first = await runEdit(f, visit.sessionId, visit.lineId, input, { userId, key, fingerprint });
  const replay = await runEdit(f, visit.sessionId, visit.lineId, input, { userId, key, fingerprint });
  expect(first).toEqual({ saved: true, edited: true });
  expect(replay).toEqual({ saved: true, edited: true });
  expect(Object.keys(first).sort()).toEqual(['edited', 'saved']);
  const [stored] = await f.h.owner`SELECT response_body::text AS body FROM idempotency_keys WHERE company_id=${f.company} AND key=${key}`;
  expect(String(stored?.['body'])).toContain('26.000');
  expect(String(stored?.['body'])).not.toContain(EDIT_REASON);
});

it('revoking read access between the call and its replay narrows the stored full body', async () => {
  const visit = await recorded(f, '25.000', '0.000');
  const key = ids.newId();
  const fingerprint = '1'.repeat(64);
  const input = editBody({ price: '24.000', discount: amount('0.000') });
  const full = await runEdit(f, visit.sessionId, visit.lineId, input, { key, fingerprint });
  expect(full).toMatchObject({ line: { price: '24.000' } });
  const deny = ids.newId();
  await f.h.owner`INSERT INTO permission_overrides(company_id,id,membership_id,permission_code,effect,scope_type,scope_id,reason,granted_by)
    VALUES(${f.company},${deny},${f.editorMembership},'read:service-sessions:branch','DENY','BRANCH',${f.branch},'Synthetic read deny',${f.ownerId})`;
  try {
    const replay = await runEdit(f, visit.sessionId, visit.lineId, input, { key, fingerprint });
    expect(replay).toEqual({ saved: true, edited: true });
    expect(Object.keys(replay).sort()).toEqual(['edited', 'saved']);
  } finally {
    await f.h.owner`DELETE FROM permission_overrides WHERE company_id=${f.company} AND id=${deny}`;
  }
});

it('keeps a sentinel reason only in service line history', async () => {
  const visit = await recorded(f);
  const reason = `sentinel-reason-${ids.newId()}`;
  const key = ids.newId();
  const result = await runEdit(f, visit.sessionId, visit.lineId, editBody({ reason }), { key });
  expect(JSON.stringify(result)).not.toContain(reason);
  const [history] = await f.h.owner`SELECT reason FROM service_line_edits WHERE company_id=${f.company} AND line_id=${visit.lineId}`;
  expect(history?.['reason']).toBe(reason);
  const leaked = await f.h.owner`SELECT 1 FROM outbox WHERE company_id=${f.company} AND aggregate_id=${visit.sessionId} AND payload::text LIKE ${'%' + reason + '%'}
    UNION ALL SELECT 1 FROM audit_log WHERE company_id=${f.company} AND entity_id=${visit.lineId} AND (after::text LIKE ${'%' + reason + '%'} OR before::text LIKE ${'%' + reason + '%'})
    UNION ALL SELECT 1 FROM idempotency_keys WHERE company_id=${f.company} AND key=${key} AND response_body::text LIKE ${'%' + reason + '%'}`;
  expect(leaked).toHaveLength(0);
});

it('stores the employee names of the line business and keeps them after a later rename', async () => {
  const other = ids.newId();
  const otherEn = 'Other Business Editor';
  const otherAr = 'أخرى';
  await f.h.owner`INSERT INTO employees(company_id,id,business_id,primary_branch_id,user_id,name_en,name_en_key,name_ar,name_ar_key,role_code,hire_date)
    VALUES(${f.company},${other},${f.secondBusiness},${f.secondBranch},${f.editorId},${otherEn},${employeeNameMatchKey(otherEn)},${otherAr},${employeeNameMatchKey(otherAr)},'staff','2026-01-01')`;
  await f.h.owner`INSERT INTO employee_branches(company_id,id,business_id,employee_id,branch_id,"from") VALUES(${f.company},${ids.newId()},${f.secondBusiness},${other},${f.secondBranch},'2026-01-01')`;
  const visit = await recorded(f);
  await runEdit(f, visit.sessionId, visit.lineId, editBody());
  const before = await f.h.owner`SELECT editor_name_ar,editor_name_en FROM service_line_edits WHERE company_id=${f.company} AND line_id=${visit.lineId}`;
  expect(before[0]).toEqual({ editor_name_ar: 'ليلى', editor_name_en: 'Layla Editor' });
  const renamed = 'Renamed Editor';
  await f.h.owner`UPDATE employees SET name_en=${renamed},name_en_key=${employeeNameMatchKey(renamed)},name_ar=NULL,name_ar_key=NULL,deleted_at=${AT.toISOString()}
    WHERE company_id=${f.company} AND id=${f.editorEmployee}`;
  const after = await f.h.owner`SELECT editor_name_ar,editor_name_en,editor_role FROM service_line_edits WHERE company_id=${f.company} AND line_id=${visit.lineId}`;
  expect(after[0]).toEqual({ editor_name_ar: 'ليلى', editor_name_en: 'Layla Editor', editor_role: 'branch_manager' });
  await f.h.owner`UPDATE employees SET name_en='Layla Editor',name_en_key=${employeeNameMatchKey('Layla Editor')},name_ar='ليلى',name_ar_key=${employeeNameMatchKey('ليلى')},deleted_at=NULL
    WHERE company_id=${f.company} AND id=${f.editorEmployee}`;
});
