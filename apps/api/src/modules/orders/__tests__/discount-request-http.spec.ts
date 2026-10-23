import { afterAll, beforeAll, expect, it } from 'vitest';
import { requestDiscountApprovalResponse } from '@pospay/contracts';
import { SYSTEM_ROLES } from '@pospay/db';
import { ids, must, discountRequestFixture, type DiscountRequestFixture } from './session.fixture.ts';

let f: DiscountRequestFixture;
const CLOCK = new Date('2026-10-15T08:00:00.000Z');
beforeAll(async () => { f = await discountRequestFixture({ ordersClock: { now: () => CLOCK } }); });
afterAll(async () => { await f?.close(); });

const post = (body: object, cookie = f.cookie, key = ids.newId()) =>
  f.h.send('POST', f.proposalBase, { cookie, company: f.company, key, body });

it('the cashier asks for an approval and gets a replayable 201', async () => {
  const key = ids.newId();
  const body = f.requestBody([f.draft(0, '25.000', '5.000', 1)]);
  const first = await post(body, f.cookie, key);
  expect(first.status).toBe(201);
  const parsed = requestDiscountApprovalResponse.parse(first.body);
  expect(parsed.proposals).toHaveLength(1);
  expect(parsed.proposals[0]?.status).toBe('PENDING');
  const replay = await post(body, f.cookie, key);
  expect(replay.status).toBe(201);
  expect(replay.body).toEqual(first.body);
});

it('the same key with another body is refused as a reused key', async () => {
  const key = ids.newId();
  const first = await post(f.requestBody([f.draft(0, '25.000', '5.000', 1)]), f.cookie, key);
  expect(first.status).toBe(201);
  const other = await post(f.requestBody([f.draft(0, '25.000', '7.500', 1)]), f.cookie, key);
  expect(other.status).toBe(422);
  expect(other.body['code']).toBe('IDEMPOTENCY_KEY_REUSED');
});

it('a line inside the limit answers 422 with the index of that line', async () => {
  const body = f.requestBody([f.draft(0, '25.000', '5.000', 1), f.draft(0, '25.000', '2.500', 1)]);
  const refused = await post(body);
  expect(refused.status).toBe(422);
  expect(refused.body['code']).toBe('DISCOUNT_APPROVAL_NOT_NEEDED');
  expect(refused.body['details']).toEqual({ input_indexes: [1] });
});

it('a visit with its own instant is a shape error, and a missing key is refused', async () => {
  const sessionId = ids.newId();
  const withBoth = await post(f.requestBody([f.draft(0, '25.000', '5.000', 1)],
    { session_id: sessionId, occurred_at: '2026-10-14T08:00:00.000Z' }));
  expect(withBoth.status).toBe(400);
  expect(withBoth.body['code']).toBe('VALIDATION_FAILED');
  const noKey = await f.h.send('POST', f.proposalBase, { cookie: f.cookie, company: f.company,
    body: f.requestBody([f.draft(0, '25.000', '5.000', 1)]) });
  expect(noKey.status).toBe(400);
  expect(noKey.body['code']).toBe('IDEMPOTENCY_KEY_REQUIRED');
});

it('a member without the record permission and another branch are both refused', async () => {
  const staffCookie = await staffMember();
  const refused = await post(f.requestBody([f.draft(0, '25.000', '5.000', 1)]), staffCookie);
  expect(refused.status).toBe(403);
  expect(refused.body['code']).toBe('FORBIDDEN');
  const otherBranch = await f.h.send('GET',
    `/v1/businesses/${f.business}/branches/${f.secondBranch}/discount-proposals?request_id=${ids.newId()}`,
    { cookie: f.cookie, company: f.company });
  expect(otherBranch.status).toBe(403);
  expect(otherBranch.body['code']).toBe('FORBIDDEN');
});

async function staffMember() {
  const cookie = await f.h.signedInOperator('discount-staff@example.test');
  const users = await f.h.owner`SELECT id FROM "user" WHERE email='discount-staff@example.test'`;
  const userId = must(users[0])['id'] as string;
  const membership = ids.newId();
  const role = must(SYSTEM_ROLES.find((item) => item.code === 'staff')).id;
  await f.h.owner`INSERT INTO memberships(company_id,id,user_id,role_id,role_owner_key,scope_type,scope_id,limit_bps,starts_at)
    VALUES(${f.company},${membership},${userId},${role},'global','BRANCH',${f.branch},1000,'2026-01-01T00:00:00Z')`;
  return cookie;
}
