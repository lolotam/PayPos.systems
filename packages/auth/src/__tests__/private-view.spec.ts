import { randomUUID } from 'node:crypto';
import { systemUuidV7 } from '@pospay/ids';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { present } from '../../../db/test/present.ts';
import { approvePhoneBinding } from '../approve-phone-binding.ts';
import type { PrivateViewProof, PrivateViewScope } from '../private-view.ts';
import type { StaffDeviceContext } from '../staff-otp/types.ts';
import { cookieHeaders, privateViewFixture } from './private-view.fixture.ts';

let f: Awaited<ReturnType<typeof privateViewFixture>>;
const ids = systemUuidV7();
let phoneSequence = 0;

beforeAll(async () => {
  f = await privateViewFixture();
});
afterAll(async () => {
  await f?.close();
});

async function open(scope: PrivateViewScope, device: StaffDeviceContext, proof?: PrivateViewProof) {
  const proven = proof ?? present(await f.prove(scope));
  const result = await f.auth.privateView.open({ proof: proven, scope, device });
  if (result.kind !== 'opened') throw new Error('PRIVATE_WINDOW_SETUP_REFUSED');
  return result;
}

it('serializes concurrent openings, sequences later ones and stores only clock timestamps', async () => {
  const session = await f.issue();
  const proofs = [present(await f.prove(session.scope)), present(await f.prove(session.scope))];
  const results = await Promise.all(
    proofs.map((proof) =>
      f.auth.privateView.open({ proof, scope: session.scope, device: session.device }),
    ),
  );
  expect(results.map((result) => result.kind)).toEqual(['opened', 'opened']);
  const latest = results.find((result) => result.kind === 'opened' && result.windowSeq === '2');
  if (latest?.kind !== 'opened') throw new Error('PRIVATE_WINDOW_SEQUENCE_MISSING');
  const stored = await f.rows(session.scope.sessionId);
  expect(stored.window).toHaveLength(1);
  expect(stored.counter.map((row) => row.value)).toEqual(['2']);
  expect(JSON.parse(present(stored.window[0]).value)).toEqual({
    window_id: latest.windowId,
    window_seq: '2',
    user_id: f.userId,
    device_id: f.device.deviceId,
  });
  expect(stored.window[0]?.created_at).toEqual(f.clock.now);
  expect(stored.window[0]?.updated_at).toEqual(f.clock.now);
  expect(stored.window[0]?.expires_at).toEqual(new Date(f.clock.now.getTime() + 300_000));
  expect(stored.counter[0]?.expires_at).toEqual(session.issued.session.deadline);
  const third = await open(session.scope, session.device);
  expect(third.windowSeq).toBe('3');
  expect((await f.rows(session.scope.sessionId)).counter[0]?.value).toBe('3');
  expect(JSON.parse(present((await f.rows(session.scope.sessionId)).window[0]).value).window_id).toBe(
    third.windowId,
  );
});

it('accepts a proof at exactly 60 seconds', async () => {
  const session = await f.issue();
  const proof = present(await f.prove(session.scope));
  f.clock.now = new Date(f.clock.now.getTime() + 60_000);
  const opened = await f.auth.privateView.open({ proof, scope: session.scope, device: session.device });
  expect(opened.kind).toBe('opened');
  expect((await f.rows(session.scope.sessionId)).window).toHaveLength(1);
  expect((await f.rows(session.scope.sessionId)).counter[0]?.value).toBe('1');
});

it.each(['stale', 'reused', 'forged', 'session', 'user', 'device'] as const)(
  'refuses a %s proof without changing stored rows',
  async (failure) => {
    const session = await f.issue();
    let proof = present(await f.prove(session.scope));
    let scope = session.scope;
    if (failure === 'stale') f.clock.now = new Date(f.clock.now.getTime() + 61_000);
    if (failure === 'reused') await open(scope, session.device, proof);
    if (failure === 'forged') proof = {} as PrivateViewProof;
    if (failure === 'session') scope = { ...scope, sessionId: randomUUID() };
    if (failure === 'user') scope = { ...scope, userId: randomUUID() };
    if (failure === 'device') scope = { ...scope, deviceId: randomUUID() };
    const before = await f.rows(session.scope.sessionId);
    expect(
      await f.auth.privateView.open({ proof, scope, device: session.device }),
    ).toEqual({ kind: 'refused', reason: 'proof' });
    expect(await f.rows(session.scope.sessionId)).toEqual(before);
    if (failure !== 'reused') expect(before.window).toHaveLength(0);
  },
);

it('lets exactly one of two simultaneous openings consume the same proof', async () => {
  const session = await f.issue();
  const proof = present(await f.prove(session.scope));
  const results = await Promise.all([
    f.auth.privateView.open({ proof, scope: session.scope, device: session.device }),
    f.auth.privateView.open({ proof, scope: session.scope, device: session.device }),
  ]);
  expect(results.map((result) => result.kind).sort()).toEqual(['opened', 'refused']);
  expect(results.find((result) => result.kind === 'refused')).toEqual({
    kind: 'refused',
    reason: 'proof',
  });
  const rows = await f.rows(session.scope.sessionId);
  expect(rows.window).toHaveLength(1);
  expect(rows.counter[0]?.value).toBe('1');
});

it('returns no proof for a wrong PIN and stores nothing', async () => {
  const session = await f.issue();
  expect(
    await f.auth.privateView.provePin({ pin: '9999', hash: f.hash, scope: session.scope }),
  ).toBeNull();
  expect(await f.rows(session.scope.sessionId)).toEqual({ window: [], counter: [] });
});

it('refuses an opening whose session row is gone and inserts nothing', async () => {
  const session = await f.issue();
  const proof = present(await f.prove(session.scope));
  await f.owner`DELETE FROM session WHERE id=${session.scope.sessionId}`;
  expect(
    await f.auth.privateView.open({ proof, scope: session.scope, device: session.device }),
  ).toEqual({ kind: 'refused', reason: 'session' });
  expect(await f.rows(session.scope.sessionId)).toEqual({ window: [], counter: [] });
});

it('passes and touches at 60 seconds, then expires and deletes at 61 seconds', async () => {
  const first = await f.issue();
  const opened = await open(first.scope, first.device);
  f.clock.now = new Date(f.clock.now.getTime() + 60_000);
  expect(await f.auth.privateView.check(first.scope, opened.windowId)).toEqual({
    kind: 'passed',
    idleRemainingMs: 60_000,
    capRemainingMs: 240_000,
  });
  expect((await f.rows(first.scope.sessionId)).window[0]?.updated_at).toEqual(f.clock.now);
  const second = await f.issue({ ...f.device, deviceId: randomUUID() });
  const other = await open(second.scope, second.device);
  f.clock.now = new Date(f.clock.now.getTime() + 61_000);
  expect(await f.auth.privateView.check(second.scope, other.windowId)).toEqual({ kind: 'expired' });
  expect((await f.rows(second.scope.sessionId)).window).toHaveLength(0);
  expect((await f.rows(second.scope.sessionId)).counter[0]?.value).toBe('1');
});

it('keeps touches every 50 seconds alive through 4:59 and closes at 5:01', async () => {
  const session = await f.issue();
  const opened = await open(session.scope, session.device);
  const started = f.clock.now.getTime();
  for (const elapsed of [50, 100, 150, 200, 250, 299]) {
    f.clock.now = new Date(started + elapsed * 1000);
    expect((await f.auth.privateView.check(session.scope, opened.windowId)).kind).toBe('passed');
  }
  expect((await f.rows(session.scope.sessionId)).window[0]?.updated_at).toEqual(f.clock.now);
  f.clock.now = new Date(started + 301_000);
  expect(await f.auth.privateView.check(session.scope, opened.windowId)).toEqual({ kind: 'expired' });
  expect((await f.rows(session.scope.sessionId)).window).toHaveLength(0);
  expect((await f.rows(session.scope.sessionId)).counter[0]?.value).toBe('1');
});

it('leaves timestamps and rows unchanged for missing, wrong, user-mismatched and device-mismatched checks', async () => {
  const session = await f.issue();
  const opened = await open(session.scope, session.device);
  const before = await f.rows(session.scope.sessionId);
  for (const [scope, windowId] of [
    [session.scope, 'missing'],
    [session.scope, randomUUID()],
    [{ ...session.scope, userId: randomUUID() }, opened.windowId],
    [{ ...session.scope, deviceId: randomUUID() }, opened.windowId],
  ] as const) {
    expect(await f.auth.privateView.check(scope, windowId)).toEqual({ kind: 'mismatch' });
    expect(await f.rows(session.scope.sessionId)).toEqual(before);
  }
});

it('fences late checks and closes to their old window id', async () => {
  const session = await f.issue();
  const old = await open(session.scope, session.device);
  const current = await open(session.scope, session.device);
  const before = await f.rows(session.scope.sessionId);
  f.clock.now = new Date(f.clock.now.getTime() + 61_000);
  expect(await f.auth.privateView.check(session.scope, old.windowId)).toEqual({ kind: 'mismatch' });
  expect(await f.auth.privateView.close(session.scope, old.windowId)).toBe(false);
  expect(await f.rows(session.scope.sessionId)).toEqual(before);
  expect(JSON.parse(present(before.window[0]).value).window_id).toBe(current.windowId);
});

it('closes only the window and retains its counter', async () => {
  const session = await f.issue();
  const opened = await open(session.scope, session.device);
  expect(await f.auth.privateView.close(session.scope, opened.windowId)).toBe(true);
  expect((await f.rows(session.scope.sessionId)).window).toHaveLength(0);
  expect((await f.rows(session.scope.sessionId)).counter[0]?.value).toBe('1');
  expect(await f.auth.privateView.close(session.scope, opened.windowId)).toBe(false);
  expect((await f.rows(session.scope.sessionId)).counter[0]?.value).toBe('1');
});

type EndKind = 'sign-out' | 'no-lock' | 'rotate' | 'approve';

async function sessionEndRace(kind: EndKind, endingFirst: boolean) {
  const session = kind === 'no-lock' ? await f.issueMalformed() : await f.issue();
  const { scope, device } = session;
  await open(scope, device);
  const otherUser = await f.auth.provisionUser({
    email: `other-${randomUUID()}@synthetic.invalid`,
    name: 'other',
    password: 'synthetic'.repeat(8),
  });
  const otherDevice = { ...f.device, deviceId: randomUUID() };
  const other = await f.auth.staff.issue(otherUser, otherDevice, async () => true);
  const otherScope = { sessionId: other.session.sessionId, userId: otherUser, deviceId: otherDevice.deviceId };
  await open(otherScope, otherDevice);
  const untouched = await f.rows(otherScope.sessionId);
  const cookie = 'issued' in session ? session.issued.cookie : session.cookie;
  const end = async (): Promise<unknown> => {
    if (kind === 'rotate') return f.auth.staff.issue(f.userId, device, async () => true);
    if (kind === 'approve') {
      phoneSequence += 1;
      return approvePhoneBinding({
        databaseUrl: f.test.authUrl,
        userId: f.userId,
        phone: `+999100000${String(phoneSequence).padStart(2, '0')}`,
        operator: 'synthetic-operator',
        ownershipVerified: true,
        approved: true,
        ids,
        phoneLockKey: () => 1n,
        clock: { now: () => f.clock.now },
        isCanonicalPhone: () => true,
      });
    }
    return f.auth.staff.signOut(cookieHeaders(cookie));
  };
  const proof = present(await f.prove(scope));
  if (!endingFirst) {
    expect((await f.auth.privateView.open({ proof, scope, device })).kind).toBe('opened');
    await end();
  } else {
    const lock = await f.holdWindowLock(scope.sessionId);
    const deadline = Date.now() + 10_000;
    try {
      const ending = end();
      void ending.catch(() => undefined);
      await f.waitForLockWaiters(1, deadline);
      const opening = f.auth.privateView.open({ proof, scope, device });
      void opening.catch(() => undefined);
      await f.waitForLockWaiters(2, deadline);
      lock.release();
      await lock.holding;
      expect(await opening).toEqual({ kind: 'refused', reason: 'session' });
      await ending;
    } finally {
      lock.release();
      await lock.holding;
    }
  }
  expect(await f.rows(scope.sessionId)).toEqual({ window: [], counter: [] });
  expect(await f.rows(otherScope.sessionId)).toEqual(untouched);
}

it.each([
  ['sign-out', false],
  ['sign-out', true],
  ['no-lock', false],
  ['no-lock', true],
  ['rotate', false],
  ['rotate', true],
  ['approve', false],
  ['approve', true],
] as const)('%s removes both rows when ending-first is %s and recreates no orphan', async (kind, endingFirst) => {
  await sessionEndRace(kind, endingFirst);
});
