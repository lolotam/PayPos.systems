import { randomUUID } from 'node:crypto';
import { makeSignature } from 'better-auth/crypto';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { present } from '../../../db/test/present.ts';
import { staffAuthFixture } from './staff-auth.fixture.ts';
import { PERSONAL_COOKIE } from '../personal-sessions.ts';
import { STAFF_COOKIE } from '../staff-sessions.ts';

let f: Awaited<ReturnType<typeof staffAuthFixture>>;

const cookieHeaders = (cookie: string) => new Headers({ cookie: present(cookie.split(';')[0]) });
const rowsOf = async (id: string) => f.owner`SELECT id FROM session WHERE id=${id}`;
const personalWorkspace = () => ({
  purpose: 'STAFF_PERSONAL' as const,
  companyId: f.device.companyId,
  businessId: f.device.businessId,
});

beforeAll(async () => {
  f = await staffAuthFixture();
});
afterAll(async () => {
  await f?.close();
});

it('ends a live staff session, clears its cookie and drops the row', async () => {
  const issued = await f.auth.staff.issue(f.userId, f.device, async () => true);
  const result = await f.auth.staff.signOut(cookieHeaders(issued.cookie));
  expect(result.ended).toBe(true);
  expect(result.cookie).toContain('Expires=Thu, 01 Jan 1970');
  expect(await rowsOf(issued.session.sessionId)).toEqual([]);
});

it('answers no session on a repeat, and still clears the cookie', async () => {
  const issued = await f.auth.staff.issue(f.userId, f.device, async () => true);
  await f.auth.staff.signOut(cookieHeaders(issued.cookie));
  const again = await f.auth.staff.signOut(cookieHeaders(issued.cookie));
  expect(again.ended).toBe(false);
  expect(again.cookie).toContain('Expires=Thu, 01 Jan 1970');
});

it('carries no cookie and no session when the request had none', async () => {
  expect(await f.auth.staff.signOut(new Headers())).toEqual({ cookie: null, ended: false });
});

it('refuses a tampered cookie, clears it and leaves its row alone', async () => {
  const issued = await f.auth.staff.issue(f.userId, f.device, async () => true);
  const tampered = present(issued.cookie.split(';')[0]).replace(/.$/, (last) =>
    last === 'a' ? 'b' : 'a',
  );
  const result = await f.auth.staff.signOut(cookieHeaders(tampered));
  expect(result.ended).toBe(false);
  expect(result.cookie).toContain('Expires=Thu, 01 Jan 1970');
  expect(await rowsOf(issued.session.sessionId)).toHaveLength(1);
});

it('leaves a personal session alone when its value is sent under the staff name', async () => {
  const personal = await f.auth.personal.issue(f.userId, personalWorkspace(), async () => true);
  const renamed = present(personal.cookie.split(';')[0]).replace(PERSONAL_COOKIE, STAFF_COOKIE);
  expect(renamed.startsWith(`${STAFF_COOKIE}=`)).toBe(true);
  const result = await f.auth.staff.signOut(new Headers({ cookie: renamed }));
  expect(result.ended).toBe(false);
  expect(result.cookie).toContain('Expires=Thu, 01 Jan 1970');
  expect(await rowsOf(personal.session.sessionId)).toHaveLength(1);
});

it('deletes a row whose deadline passed and answers no session', async () => {
  const issued = await f.auth.staff.issue(f.userId, f.device, async () => true);
  const during = f.clock.now;
  f.clock.now = issued.session.deadline;
  try {
    expect((await f.auth.staff.signOut(cookieHeaders(issued.cookie))).ended).toBe(false);
  } finally {
    f.clock.now = during;
  }
  expect(await rowsOf(issued.session.sessionId)).toEqual([]);
});

it('deletes a malformed staff row without the device lock and answers no session', async () => {
  const token = randomUUID();
  const id = randomUUID();
  const context = { ...f.device, deviceId: 'not-a-uuid' };
  const deadline = new Date(f.clock.now.getTime() + 28_800_000);
  await f.owner`INSERT INTO session(id,token,user_id,expires_at,purpose,staff_device_context,
    staff_authenticated_at,staff_absolute_deadline)
    VALUES(${id},${token},${f.userId},${deadline},'STAFF_POS',${f.owner.json(context)},${f.clock.now},${deadline})`;
  const cookie = `${STAFF_COOKIE}=${encodeURIComponent(`${token}.${await makeSignature(token, 'synthetic'.repeat(8))}`)}`;
  const result = await f.auth.staff.signOut(new Headers({ cookie }));
  expect(result.ended).toBe(false);
  expect(await rowsOf(id)).toEqual([]);
});

it('ends the session its own cookie names, whatever device the caller holds', async () => {
  const other = { ...f.device, deviceId: randomUUID() };
  const issued = await f.auth.staff.issue(f.userId, other, async () => true);
  const result = await f.auth.staff.signOut(cookieHeaders(issued.cookie));
  expect(result.ended).toBe(true);
  expect(await rowsOf(issued.session.sessionId)).toEqual([]);
});

it('ends a session of a user whose phone approval was removed', async () => {
  const issued = await f.auth.staff.issue(f.userId, f.device, async () => true);
  await f.owner`UPDATE "user" SET phone_binding_approved_at=NULL WHERE id=${f.userId}`;
  try {
    expect((await f.auth.staff.signOut(cookieHeaders(issued.cookie))).ended).toBe(true);
  } finally {
    await f.owner`UPDATE "user" SET phone_binding_approved_at=${f.clock.now} WHERE id=${f.userId}`;
  }
  expect(await rowsOf(issued.session.sessionId)).toEqual([]);
});

it('lets exactly one of two concurrent sign-outs end the session', async () => {
  const issued = await f.auth.staff.issue(f.userId, f.device, async () => true);
  const headers = cookieHeaders(issued.cookie);
  const results = await Promise.all([f.auth.staff.signOut(headers), f.auth.staff.signOut(headers)]);
  expect(results.filter((result) => result.ended)).toHaveLength(1);
});
