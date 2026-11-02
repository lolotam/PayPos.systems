import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { present } from '../../../db/test/present.ts';
import type { PrivateViewScope } from '../private-view.ts';
import type { StaffDeviceContext } from '../staff-otp/types.ts';
import { privateViewFixture } from './private-view.fixture.ts';

let f: Awaited<ReturnType<typeof privateViewFixture>>;

beforeAll(async () => {
  f = await privateViewFixture();
});
afterAll(async () => {
  await f?.close();
});

/** يفتح نافذة بإثبات PIN حقيقي؛ الاختبارات اللي عايزة نتيجة مرفوضة بتستدعي open بنفسها. */
async function openWindow(scope: PrivateViewScope, device: StaffDeviceContext) {
  const proof = present(await f.prove(scope));
  const result = await f.auth.privateView.open({ proof, scope, device });
  if (result.kind !== 'opened') throw new Error('PRIVATE_WINDOW_SETUP_REFUSED');
  return result;
}

it('refuses an opening whose scope device is not the locked session device', async () => {
  const session = await f.issue();
  const spoofed = { ...session.scope, deviceId: randomUUID() };
  const before = await f.rows(session.scope.sessionId);
  const proof = present(await f.prove(spoofed));
  expect(
    await f.auth.privateView.open({
      proof,
      scope: spoofed,
      device: { ...session.device, deviceId: spoofed.deviceId },
    }),
  ).toEqual({ kind: 'refused', reason: 'session' });
  expect(await f.rows(session.scope.sessionId)).toEqual(before);
  // الجهاز الحقيقي مع نطاق مزوّر: ده هو الثغنة نفسها — قبل الربط كانت النافذة بتتفتح وتكتب device_id من العميل.
  const exploit = present(await f.prove(spoofed));
  expect(
    await f.auth.privateView.open({ proof: exploit, scope: spoofed, device: session.device }),
  ).toEqual({ kind: 'refused', reason: 'session' });
  expect(await f.rows(session.scope.sessionId)).toEqual(before);
});

it('refuses an opening whose scope user is not the locked session user', async () => {
  const session = await f.issue();
  const spoofed = { ...session.scope, userId: randomUUID() };
  const before = await f.rows(session.scope.sessionId);
  const proof = present(await f.prove(spoofed));
  expect(
    await f.auth.privateView.open({ proof, scope: spoofed, device: session.device }),
  ).toEqual({ kind: 'refused', reason: 'session' });
  expect(await f.rows(session.scope.sessionId)).toEqual(before);
});

it('refuses an opening at the session deadline and inserts nothing', async () => {
  const session = await f.issue();
  f.clock.now = session.issued.session.deadline;
  const before = await f.rows(session.scope.sessionId);
  const proof = present(await f.prove(session.scope));
  expect(
    await f.auth.privateView.open({ proof, scope: session.scope, device: session.device }),
  ).toEqual({ kind: 'refused', reason: 'session' });
  expect(await f.rows(session.scope.sessionId)).toEqual(before);
});

it('answers a mismatch when the session row is gone and leaves the window untouched', async () => {
  const session = await f.issue();
  const opened = await openWindow(session.scope, session.device);
  const before = await f.rows(session.scope.sessionId);
  await f.owner`DELETE FROM session WHERE id=${session.scope.sessionId}`;
  expect(await f.auth.privateView.check(session.scope, opened.windowId)).toEqual({
    kind: 'mismatch',
  });
  expect(await f.rows(session.scope.sessionId)).toEqual(before);
});

it('keeps a touched window alive to exactly the cap with no remaining time', async () => {
  const session = await f.issue();
  const opened = await openWindow(session.scope, session.device);
  const started = f.clock.now.getTime();
  for (const elapsed of [50, 100, 150, 200, 250]) {
    f.clock.now = new Date(started + elapsed * 1000);
    expect((await f.auth.privateView.check(session.scope, opened.windowId)).kind).toBe('passed');
  }
  f.clock.now = new Date(started + 300_000);
  expect(await f.auth.privateView.check(session.scope, opened.windowId)).toEqual({
    kind: 'passed',
    idleRemainingMs: 0,
    capRemainingMs: 0,
  });
  const rows = await f.rows(session.scope.sessionId);
  expect(rows.window).toHaveLength(1);
  expect(rows.window[0]?.updated_at).toEqual(f.clock.now);
});

it('keeps an expired window on a scope mismatch and deletes it on the matching check', async () => {
  const session = await f.issue();
  const opened = await openWindow(session.scope, session.device);
  f.clock.now = new Date(f.clock.now.getTime() + 61_000);
  const before = await f.rows(session.scope.sessionId);
  expect(
    await f.auth.privateView.check({ ...session.scope, userId: randomUUID() }, opened.windowId),
  ).toEqual({ kind: 'mismatch' });
  expect(await f.rows(session.scope.sessionId)).toEqual(before);
  expect(
    await f.auth.privateView.check({ ...session.scope, deviceId: randomUUID() }, opened.windowId),
  ).toEqual({ kind: 'mismatch' });
  expect(await f.rows(session.scope.sessionId)).toEqual(before);
  expect(await f.auth.privateView.check(session.scope, opened.windowId)).toEqual({ kind: 'expired' });
  const rows = await f.rows(session.scope.sessionId);
  expect(rows.window).toHaveLength(0);
  expect(rows.counter[0]?.value).toBe('1');
});
