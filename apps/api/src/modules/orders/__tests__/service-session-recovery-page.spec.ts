import { serviceSessionRecoveryPage } from '@pospay/contracts';
import { afterAll, afterEach, beforeAll, expect, it } from 'vitest';
import { recoveryKeyHash } from '../persistence/session-recovery.adapter.ts';
import { cancelServiceLine } from '../../../../../../packages/db/test/service-line-cancellation.ts';
import { AT, ids, must, sessionFixture, type SessionFixture } from './session.fixture.ts';

let f: SessionFixture;
const EPOCH = 'recovery_feature_started_at=2020-01-01T00:00:00.000000Z';
beforeAll(async () => {
  f = await sessionFixture({ ordersClock: { now: () => f?.clock.now() ?? AT } });
  await f.h.owner.unsafe(`COMMENT ON TABLE service_session_recoveries IS '${EPOCH}'`);
});
afterEach(() => { f?.setAt(AT); });
afterAll(async () => { await f?.close(); });

async function read(key: string, operation = 'record-service-session', cursor?: string) {
  const res = await f.h.app.inject({ method: 'GET', url: `${f.base}/recovery?${new URLSearchParams({ operation, ...(cursor === undefined ? {} : { cursor }) })}`,
    headers: { cookie: f.cookie, 'x-company-id': f.company, 'x-recovery-key': key } });
  return { status: res.statusCode, body: res.json() as Record<string, unknown> };
}
async function openProof(key: string, operation = 'record-service-session') {
  await f.h.owner`UPDATE service_session_recoveries SET last_seen_at = issued_at - interval '25 hours'
    WHERE company_id=${f.company} AND operation=${operation} AND key_hash=${recoveryKeyHash(key)}`;
}
async function page(key: string, operation = 'record-service-session', cursor?: string) {
  const response = await read(key, operation, cursor);
  expect(response.status).toBe(200);
  return serviceSessionRecoveryPage.parse(response.body);
}
function cursorFor(proof: string, at: string, id: string, operation = 'record-service-session') {
  return Buffer.from(JSON.stringify({ v: 1, company: f.company, business: f.business, branch: f.branch, operation, proof, at, id })).toString('base64url');
}
async function cloneLine(source: string, session: string, ordinal: number, inputIndex: number, status: string, nameEn: string, recordedBy: string, membership: string) {
  const line = ids.newId();
  const stored = status === 'CANCELLED' ? 'ACTIVE' : status;
  // القيد المؤجّل يرفض البند قبل الـ commit لو مجموعة المؤدين ناقصة، وحارس الإلغاء يرفض إدراج بند ملغي.
  await f.h.owner.begin(async (tx) => {
    await tx`INSERT INTO service_lines(company_id,id,business_id,session_id,service_id,ordinal,input_index,status,revision,
        list_price,price,discount,net,effective_discount_bps,limit_bps_applied,limit_source,name_en,name_ar,catalog_revision,
        rule_kind,rule_pct_bps,rule_fixed_amount,counts_toward_threshold,has_performer_warning,recorded_by,recorded_by_membership_id,recorded_at,late)
      SELECT company_id,${line},business_id,${session},service_id,${ordinal},${inputIndex},${stored},revision,
        list_price,price,discount,net,effective_discount_bps,limit_bps_applied,limit_source,${nameEn},name_ar,catalog_revision,
        rule_kind,rule_pct_bps,rule_fixed_amount,counts_toward_threshold,has_performer_warning,${recordedBy},${membership},recorded_at,late
      FROM service_lines WHERE company_id=${f.company} AND id=${source}`;
    await tx`INSERT INTO line_performers(company_id,id,business_id,line_id,employee_id,performer_ordinal,share_bps,name_en,name_ar,not_clocked_in_warning,approved_leave_warning)
      SELECT company_id,gen_random_uuid(),business_id,${line},employee_id,performer_ordinal,share_bps,name_en,name_ar,not_clocked_in_warning,approved_leave_warning
      FROM line_performers WHERE company_id=${f.company} AND line_id=${source}`;
  });
  if (status !== 'CANCELLED') return;
  const [row] = await f.h.owner`SELECT revision FROM service_lines WHERE company_id=${f.company} AND id=${line}`;
  await f.db.withTenant(f.company, (tx) => cancelServiceLine(tx, {
    companyId: f.company, lineId: line, expectedRevision: Number(must(row)['revision']),
    cancelledBy: recordedBy, membershipId: membership, cancellationId: ids.newId(),
  }), { userId: recordedBy });
}

it('lists a back-dated cross-month visit on the proof date', async () => {
  const key = ids.newId();
  const saved = await f.create.execute({ ...f.context(key), input: { ...f.body(), occurred_at: '2026-09-15T08:00:00.000Z' } });
  await openProof(key);
  const result = await page(key);
  expect(result.attempt.business_date).toBe('2026-09-15');
  expect(result.items.map((item) => item.id)).toEqual([saved.session.id]);
  expect(result.attempt.outcome).toBe('COMMITTED');
});

it('returns NOT_COMMITTED for an unlinked create, an omitted occurred_at and a refused append', async () => {
  const unlinked = ids.newId();
  await expect(f.create.execute({ ...f.context(unlinked), input: { ...f.body(), occurred_at: '2026-10-08T08:00:00.000Z', customer_id: ids.newId() } })).rejects.toThrow('SESSION_CUSTOMER_NOT_FOUND');
  await openProof(unlinked);
  const missing = await page(unlinked);
  expect(missing.attempt).toMatchObject({ business_date: '2026-10-08', outcome: 'NOT_COMMITTED' });
  expect(missing.items).toEqual([]);
  const omitted = ids.newId();
  await expect(f.create.execute({ ...f.context(omitted), input: { customer_id: ids.newId(), lines: [f.line()] } })).rejects.toThrow('SESSION_CUSTOMER_NOT_FOUND');
  await openProof(omitted);
  expect((await page(omitted)).attempt).toMatchObject({ business_date: '2026-10-15', outcome: 'NOT_COMMITTED' });
  const created = await f.create.execute({ ...f.context(), input: { ...f.body(), occurred_at: '2026-10-07T08:00:00.000Z' } });
  const refused = ids.newId();
  await expect(f.append.execute({ ...f.context(refused), sessionId: created.session.id, input: { lines: [f.line(ids.newId())] } })).rejects.toThrow('SESSION_SERVICE_NOT_FOUND');
  await openProof(refused, 'append-service-session-lines');
  const append = await page(refused, 'append-service-session-lines');
  expect(append.attempt).toMatchObject({ business_date: '2026-10-07', outcome: 'NOT_COMMITTED' });
  expect(append.items.map((item) => item.id)).toEqual([created.session.id]);
});

it('hides foreign and cancelled lines and drops a visit that has no own active line', async () => {
  const key = ids.newId();
  const saved = await f.create.execute({ ...f.context(key), input: { ...f.body(), occurred_at: '2026-10-05T08:00:00.000Z' } });
  const own = must(saved.session.lines[0]);
  const [ownerMembership] = await f.h.owner`SELECT id FROM memberships WHERE company_id=${f.company} AND user_id=${f.ownerId}`;
  const ownerMembershipId = String(must(ownerMembership)['id']);
  const foreignVisit = ids.newId();
  await cloneLine(own.id, saved.session.id, 2, 1, 'ACTIVE', 'Foreign line', f.ownerId, ownerMembershipId);
  await cloneLine(own.id, saved.session.id, 3, 2, 'CANCELLED', own.name_en, f.userId, f.membership);
  await f.h.owner`INSERT INTO service_sessions(company_id,id,business_id,branch_id,customer_id,customer_name,customer_phone_masked,
      occurred_at,recorded_at,business_date,business_timezone,recorded_by,recorded_by_membership_id,late)
    SELECT company_id,${foreignVisit},business_id,branch_id,customer_id,customer_name,customer_phone_masked,
      occurred_at + interval '1 second',recorded_at,business_date,business_timezone,recorded_by,recorded_by_membership_id,late
    FROM service_sessions WHERE company_id=${f.company} AND id=${saved.session.id}`;
  await cloneLine(own.id, foreignVisit, 1, 0, 'ACTIVE', 'Foreign visit', f.ownerId, ownerMembershipId);
  await openProof(key);
  const result = await page(key);
  expect(result.items.map((item) => item.id)).toEqual([saved.session.id]);
  expect(must(result.items[0]).lines).toHaveLength(1);
  expect(must(result.items[0]).lines.map((line) => line.name_en)).toEqual([own.name_en]);
});

it('links COMMITTED after a stored committed replay and rejects another proof cursor before the gate', async () => {
  const key = ids.newId();
  const first = await f.create.execute({ ...f.context(key), input: { ...f.body(), occurred_at: '2026-10-12T08:00:00.000Z' } });
  await f.h.owner`DELETE FROM service_session_recoveries WHERE company_id=${f.company} AND key_hash=${recoveryKeyHash(key)}`;
  const replay = await f.create.execute({ ...f.context(key), input: { ...f.body(), occurred_at: '2026-10-12T08:00:00.000Z' } });
  expect(replay.session.id).toBe(first.session.id);
  await openProof(key);
  expect((await page(key)).attempt.outcome).toBe('COMMITTED');
  const other = ids.newId();
  await f.create.execute({ ...f.context(other), input: { ...f.body(), occurred_at: '2026-10-04T08:00:00.000Z' } });
  const otherId = must((await f.h.owner`SELECT id FROM service_session_recoveries WHERE company_id=${f.company} AND key_hash=${recoveryKeyHash(other)}`)[0])['id'];
  const mismatch = await read(key, 'record-service-session', cursorFor(String(otherId), '2026-10-12T08:00:00.000000Z', first.session.id));
  expect(mismatch.status).toBe(400);
  expect(mismatch.body['code']).toBe('VALIDATION_FAILED');
});

it('orders a tied timestamp by visit id, not by insert order', async () => {
  const key = ids.newId();
  const at = '2026-10-02T08:00:00.000Z';
  const saved = await f.create.execute({ ...f.context(key), input: { ...f.body(), occurred_at: at } });
  const own = must(saved.session.lines[0]).id;
  const extra = [
    { id: '01900000-0000-7000-8000-0000000000b2', line: ids.newId(), at },
    { id: '01900000-0000-7000-8000-0000000000b3', line: ids.newId(), at: '2026-10-02T10:00:00.000Z' },
    { id: '01900000-0000-7000-8000-0000000000b1', line: ids.newId(), at },
  ];
  const data = JSON.stringify(extra);
  await f.h.owner`INSERT INTO service_sessions(company_id,id,business_id,branch_id,customer_id,customer_name,customer_phone_masked,
      occurred_at,recorded_at,business_date,business_timezone,recorded_by,recorded_by_membership_id,late)
    SELECT s.company_id,r.id,s.business_id,s.branch_id,s.customer_id,s.customer_name,s.customer_phone_masked,r.at::timestamptz,
      s.recorded_at,s.business_date,s.business_timezone,s.recorded_by,s.recorded_by_membership_id,s.late
    FROM jsonb_to_recordset(${data}::text::jsonb) r(id uuid,at text) CROSS JOIN service_sessions s WHERE s.company_id=${f.company} AND s.id=${saved.session.id}`;
  await f.h.owner.begin(async (tx) => {
    await tx`INSERT INTO service_lines(company_id,id,business_id,session_id,service_id,ordinal,input_index,status,revision,
        list_price,price,discount,net,effective_discount_bps,limit_bps_applied,limit_source,name_en,name_ar,catalog_revision,
        rule_kind,rule_pct_bps,rule_fixed_amount,counts_toward_threshold,has_performer_warning,recorded_by,recorded_by_membership_id,recorded_at,late)
      SELECT l.company_id,r.line,l.business_id,r.id,l.service_id,l.ordinal,l.input_index,l.status,l.revision,
        l.list_price,l.price,l.discount,l.net,l.effective_discount_bps,l.limit_bps_applied,l.limit_source,l.name_en,l.name_ar,l.catalog_revision,
        l.rule_kind,l.rule_pct_bps,l.rule_fixed_amount,l.counts_toward_threshold,l.has_performer_warning,l.recorded_by,l.recorded_by_membership_id,l.recorded_at,l.late
      FROM jsonb_to_recordset(${data}::text::jsonb) r(id uuid,line uuid) CROSS JOIN service_lines l WHERE l.company_id=${f.company} AND l.id=${own}`;
    await tx`INSERT INTO line_performers(company_id,id,business_id,line_id,employee_id,performer_ordinal,share_bps,name_en,name_ar,not_clocked_in_warning,approved_leave_warning)
      SELECT p.company_id,gen_random_uuid(),p.business_id,r.line,p.employee_id,p.performer_ordinal,p.share_bps,p.name_en,p.name_ar,p.not_clocked_in_warning,p.approved_leave_warning
      FROM jsonb_to_recordset(${data}::text::jsonb) r(line uuid) CROSS JOIN line_performers p WHERE p.company_id=${f.company} AND p.line_id=${own}`;
  });
  await openProof(key);
  const expected = [{ id: saved.session.id, at }, ...extra].sort((left, right) => left.at < right.at ? -1 : left.at > right.at ? 1 : left.id < right.id ? -1 : left.id > right.id ? 1 : 0);
  expect((await page(key)).items.map((item) => item.id)).toEqual(expected.map((row) => row.id));
});

it('reaches the 51st visit and re-checks the proof on the next page', async () => {
  const key = ids.newId();
  const saved = await f.create.execute({ ...f.context(key), input: { ...f.body(), occurred_at: '2026-10-06T08:00:00.000Z' } });
  const own = must(saved.session.lines[0]).id;
  const extra = Array.from({ length: 51 }, (_, n) => ({ id: ids.newId(), line: ids.newId(), at: new Date(Date.parse('2026-10-06T08:00:01.000Z') + n * 1000).toISOString() }));
  const data = JSON.stringify(extra);
  await f.h.owner`INSERT INTO service_sessions(company_id,id,business_id,branch_id,customer_id,customer_name,customer_phone_masked,
      occurred_at,recorded_at,business_date,business_timezone,recorded_by,recorded_by_membership_id,late)
    SELECT s.company_id,r.id,s.business_id,s.branch_id,s.customer_id,s.customer_name,s.customer_phone_masked,r.at::timestamptz,
      s.recorded_at,s.business_date,s.business_timezone,s.recorded_by,s.recorded_by_membership_id,s.late
    FROM jsonb_to_recordset(${data}::text::jsonb) r(id uuid,at text) CROSS JOIN service_sessions s WHERE s.company_id=${f.company} AND s.id=${saved.session.id}`;
  await f.h.owner.begin(async (tx) => {
    await tx`INSERT INTO service_lines(company_id,id,business_id,session_id,service_id,ordinal,input_index,status,revision,
        list_price,price,discount,net,effective_discount_bps,limit_bps_applied,limit_source,name_en,name_ar,catalog_revision,
        rule_kind,rule_pct_bps,rule_fixed_amount,counts_toward_threshold,has_performer_warning,recorded_by,recorded_by_membership_id,recorded_at,late)
      SELECT l.company_id,r.line,l.business_id,r.id,l.service_id,l.ordinal,l.input_index,l.status,l.revision,
        l.list_price,l.price,l.discount,l.net,l.effective_discount_bps,l.limit_bps_applied,l.limit_source,l.name_en,l.name_ar,l.catalog_revision,
        l.rule_kind,l.rule_pct_bps,l.rule_fixed_amount,l.counts_toward_threshold,l.has_performer_warning,l.recorded_by,l.recorded_by_membership_id,l.recorded_at,l.late
      FROM jsonb_to_recordset(${data}::text::jsonb) r(id uuid,line uuid) CROSS JOIN service_lines l WHERE l.company_id=${f.company} AND l.id=${own}`;
    await tx`INSERT INTO line_performers(company_id,id,business_id,line_id,employee_id,performer_ordinal,share_bps,name_en,name_ar,not_clocked_in_warning,approved_leave_warning)
      SELECT p.company_id,gen_random_uuid(),p.business_id,r.line,p.employee_id,p.performer_ordinal,p.share_bps,p.name_en,p.name_ar,p.not_clocked_in_warning,p.approved_leave_warning
      FROM jsonb_to_recordset(${data}::text::jsonb) r(line uuid) CROSS JOIN line_performers p WHERE p.company_id=${f.company} AND p.line_id=${own}`;
  });
  await openProof(key);
  const first = await page(key);
  expect(first.items).toHaveLength(50);
  expect(first.next_cursor).not.toBeNull();
  const second = await page(key, 'record-service-session', must(first.next_cursor));
  expect(second.items.map((item) => item.id)).toEqual(extra.slice(49).map((row) => row.id));
  expect(second.next_cursor).toBeNull();
  await f.h.owner`UPDATE service_session_recoveries SET last_seen_at=${AT.toISOString()}::timestamptz WHERE company_id=${f.company} AND key_hash=${recoveryKeyHash(key)}`;
  expect((await read(key, 'record-service-session', must(first.next_cursor))).body['code']).toBe('SESSION_RECOVERY_NOT_YET');
  await f.h.app.inject({ method: 'POST', url: `${f.base}/recovery/confirm`, headers: { cookie: f.cookie, 'x-company-id': f.company, 'x-recovery-key': key },
    payload: { operation: 'record-service-session', outcome: 'RECORDED_ELSEWHERE' } });
  expect((await read(key, 'record-service-session', must(first.next_cursor))).body).toMatchObject({ code: 'SESSION_RECOVERY_CLOSED', details: { reason: 'REVOKED' } });
});

it('omits outcome inside 48h of the feature start and shows it at exactly 48h', async () => {
  const key = ids.newId();
  await f.create.execute({ ...f.context(key), input: { ...f.body(), occurred_at: '2026-10-03T08:00:00.000Z' } });
  await openProof(key);
  const [row] = await f.h.owner`SELECT issued_at FROM service_session_recoveries WHERE company_id=${f.company} AND key_hash=${recoveryKeyHash(key)}`;
  const issued = new Date(must(row)['issued_at'] as string | Date);
  const stamp = (offset: number) => new Date(issued.getTime() - offset).toISOString();
  try {
    await f.h.owner.unsafe(`COMMENT ON TABLE service_session_recoveries IS 'recovery_feature_started_at=${stamp(47 * 3_600_000)}'`);
    expect((await page(key)).attempt).not.toHaveProperty('outcome');
    await f.h.owner.unsafe(`COMMENT ON TABLE service_session_recoveries IS 'recovery_feature_started_at=${stamp(48 * 3_600_000)}'`);
    expect((await page(key)).attempt.outcome).toBe('COMMITTED');
  } finally { await f.h.owner.unsafe(`COMMENT ON TABLE service_session_recoveries IS '${EPOCH}'`); }
});
