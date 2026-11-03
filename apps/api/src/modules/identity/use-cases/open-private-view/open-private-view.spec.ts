import { expect, it, vi } from 'vitest';
import type { PrivateViewOpenResult, PrivateViewProof } from '@pospay/auth';
import { OpenPrivateView } from './open-private-view.ts';
import type { PinAttempts } from '../../ports/cashier-pins.port.ts';
import type { PrivateViewAuthority } from '../../ports/private-view.port.ts';
import type { StaffPinAuthority, StaffPinTransactions } from '../../ports/staff-pins.port.ts';

const device = {
  companyId: 'synthetic-company',
  businessId: 'synthetic-business',
  branchId: 'synthetic-branch',
  deviceId: 'synthetic-device',
};
const session = {
  userId: 'synthetic-user',
  sessionId: 'synthetic-session',
  context: device,
  authenticatedAt: new Date('2026-01-01T00:00:00.000Z'),
  deadline: new Date('2026-01-01T08:00:00.000Z'),
};
const pin = '1234';
// عمر الدليل في packages/auth (PRIVATE_VIEW_PROOF_MAX_AGE_MS): دقيقة واحدة بالظبط.
const PROOF_MAX_AGE_MS = 60_000;
const proof = { minted: true } as unknown as PrivateViewProof;
type AuditEntry = { entity: string; entityId: string; action: string };

/** سطور التدقيق بتتخزن بعد نجاح الـ commit بس، عشان نافذة مفتوحة من غير سطر تدقيق ما تبقىش واقعة. */
function fakeTransactions() {
  const auditRows: AuditEntry[] = [];
  const record = vi.fn(async (entry: AuditEntry) => {
    auditRows.push(entry);
  });
  const transaction: { commitError: Error | null } = { commitError: null };
  const credential = { id: 'synthetic-record' };
  const run = vi.fn(
    async (
      _companyId: string,
      _actor: string | null,
      work: (scope: unknown) => Promise<unknown>,
    ) => {
      const pending: AuditEntry[] = [];
      const value = await work({
        find: async () => ({ id: credential.id, hash: 'synthetic-hash' }),
        audit: {
          record: async (entry: AuditEntry) => {
            pending.push(entry);
          },
        },
      });
      if (_actor !== null && transaction.commitError !== null) throw transaction.commitError;
      for (const entry of pending) await record(entry);
      return value;
    },
  );
  const db = { run } as unknown as StaffPinTransactions;
  return { auditRows, transaction, credential, record, run, db };
}

/** العدّاد بيرجع نجاح افتراضياً؛ الاختبار اللي عايز القفل هو اللي بيستبدله. */
function fakeAttempts() {
  const reserve = vi.fn<PinAttempts['reserve']>(async () => ({
    kind: 'ok',
    reservation: 'synthetic-reservation',
  }));
  const failed = vi.fn<PinAttempts['failed']>(async () => 'failed');
  const succeeded = vi.fn<PinAttempts['succeeded']>(async () => 'ok');
  const release = vi.fn<PinAttempts['release']>(async () => undefined);
  const attempts = { reserve, failed, succeeded, release } as unknown as PinAttempts;
  return { reserve, failed, succeeded, release, attempts };
}

/** التأهل بيتأجل لوقت الفتح عشان عضوية أو جهاز اتغيّروا بعد الجلسة ما يفتحوش نافذة. */
function fakeStaffEligibility() {
  const eligible = vi.fn(async () => true);
  const deviceValid = vi.fn(async () => true);
  const authority = { eligible, deviceValid } as unknown as Pick<
    StaffPinAuthority,
    'eligible' | 'deviceValid'
  >;
  return { eligible, deviceValid, authority };
}

/** نافذة العرض الخاص: الدليل بيتقادم بعد دقيقة، فالفتح بعد كده مرفوض. */
function fakePrivateView() {
  const clock = { at: new Date('2026-01-01T00:00:00.000Z') };
  let provenAt = clock.at;
  const provePin = vi.fn(async (input: { hash: string | null }) => {
    provenAt = clock.at;
    return input.hash === 'synthetic-hash' ? proof : null;
  });
  const openWindow = vi.fn(async (): Promise<PrivateViewOpenResult> => {
    // الدليل بيتقادم لو الوقت عدّى بين المقارنة والفتح.
    if (clock.at.getTime() - provenAt.getTime() > PROOF_MAX_AGE_MS)
      return { kind: 'refused' as const, reason: 'proof' as const };
    return {
      kind: 'opened' as const,
      windowId: 'synthetic-window',
      windowSeq: 'synthetic-seq',
      sessionRef: 'synthetic-ref',
      idleRemainingMs: 60_000,
      capRemainingMs: 300_000,
    };
  });
  const closeWindow = vi.fn<PrivateViewAuthority['close']>(async () => true);
  const privateView = {
    provePin,
    open: openWindow,
    close: closeWindow,
  } as unknown as PrivateViewAuthority;
  return { clock, provePin, openWindow, closeWindow, privateView };
}

function fixture() {
  const store = fakeTransactions();
  const attempts = fakeAttempts();
  const staff = fakeStaffEligibility();
  const privateView = fakePrivateView();
  return {
    auditRows: store.auditRows,
    transaction: store.transaction,
    credential: store.credential,
    record: store.record,
    run: store.run,
    reserve: attempts.reserve,
    failed: attempts.failed,
    succeeded: attempts.succeeded,
    release: attempts.release,
    eligible: staff.eligible,
    deviceValid: staff.deviceValid,
    clock: privateView.clock,
    provePin: privateView.provePin,
    openWindow: privateView.openWindow,
    closeWindow: privateView.closeWindow,
    open: new OpenPrivateView(
      store.db,
      attempts.attempts,
      staff.authority,
      privateView.privateView,
    ),
  };
}

it('a refused reservation burns one comparison and never reads the stored hash', async () => {
  const f = fixture();
  f.reserve.mockResolvedValue({ kind: 'locked' });
  expect(await f.open.execute({ pin, session })).toEqual({ kind: 'refused' });
  expect(f.provePin).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ pin, hash: null }));
  expect(f.run).not.toHaveBeenCalled();
  expect(f.openWindow).not.toHaveBeenCalled();
});

it('a wrong PIN counts a failure and opens nothing', async () => {
  const f = fixture();
  f.run.mockImplementation(async (_company, _actor, work: (scope: unknown) => Promise<unknown>) =>
    work({
      find: async () => ({ id: 'synthetic-record', hash: 'synthetic-other-hash' }),
      audit: { record: f.record },
    }),
  );
  expect(await f.open.execute({ pin, session })).toEqual({ kind: 'refused' });
  expect(f.failed).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({ employeeId: 'staff-user:synthetic-user' }),
    'synthetic-reservation',
  );
  expect(f.openWindow).not.toHaveBeenCalled();
  expect(f.record).not.toHaveBeenCalled();
});

it('a comparison error releases the reservation and is rethrown', async () => {
  const f = fixture();
  f.provePin.mockRejectedValue(new Error('synthetic failure'));
  await expect(f.open.execute({ pin, session })).rejects.toThrow('synthetic failure');
  expect(f.release).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({ employeeId: 'staff-user:synthetic-user' }),
    'synthetic-reservation',
  );
  expect(f.failed).not.toHaveBeenCalled();
});

it('a locked counter after a correct PIN refuses without opening', async () => {
  const f = fixture();
  f.succeeded.mockResolvedValue('locked');
  expect(await f.open.execute({ pin, session })).toEqual({ kind: 'refused' });
  expect(f.openWindow).not.toHaveBeenCalled();
  expect(f.record).not.toHaveBeenCalled();
});

it('an operator who lost the membership never reaches the opening', async () => {
  const f = fixture();
  f.eligible.mockResolvedValue(false);
  expect(await f.open.execute({ pin, session })).toEqual({ kind: 'session-ended' });
  expect(f.openWindow).not.toHaveBeenCalled();
});

it('a device that is no longer valid never reaches the opening', async () => {
  const f = fixture();
  f.deviceValid.mockResolvedValue(false);
  expect(await f.open.execute({ pin, session })).toEqual({ kind: 'session-ended' });
  expect(f.openWindow).not.toHaveBeenCalled();
});

it('a refused opening writes no audit row and never closes a window', async () => {
  const f = fixture();
  f.openWindow.mockResolvedValue({ kind: 'refused', reason: 'session' });
  expect(await f.open.execute({ pin, session })).toEqual({ kind: 'session-ended' });
  expect(f.auditRows).toEqual([]);
  expect(f.record).not.toHaveBeenCalled();
  expect(f.closeWindow).not.toHaveBeenCalled();
});

it('an opened window writes one audit row and answers the window', async () => {
  const f = fixture();
  expect(await f.open.execute({ pin, session })).toEqual({
    kind: 'opened',
    windowId: 'synthetic-window',
    windowSeq: 'synthetic-seq',
    sessionRef: 'synthetic-ref',
    idleRemainingMs: 60_000,
    capRemainingMs: 300_000,
  });
  expect(f.record).toHaveBeenCalledExactlyOnceWith({
    entity: 'cashier_pin',
    entityId: 'synthetic-user',
    action: 'staff.private_view_opened',
  });
  expect(f.auditRows).toEqual([
    {
      entity: 'cashier_pin',
      entityId: 'synthetic-user',
      action: 'staff.private_view_opened',
    },
  ]);
});

it('a PIN reset during the comparison opens nothing and writes no audit row', async () => {
  const f = fixture();
  const compare = f.provePin.getMockImplementation();
  f.provePin.mockImplementation(async (args) => {
    f.credential.id = 'synthetic-reset-record';
    return compare === undefined ? null : compare(args);
  });
  expect(await f.open.execute({ pin, session })).toEqual({ kind: 'refused' });
  expect(f.auditRows).toEqual([]);
  expect(f.openWindow).not.toHaveBeenCalled();
});

it('a commit failure after the window opened closes the window and rethrows', async () => {
  const f = fixture();
  const commitError = new Error('synthetic commit failure');
  f.transaction.commitError = commitError;
  await expect(f.open.execute({ pin, session })).rejects.toBe(commitError);
  expect(f.closeWindow).toHaveBeenCalledExactlyOnceWith(
    {
      sessionId: 'synthetic-session',
      userId: 'synthetic-user',
      deviceId: 'synthetic-device',
    },
    'synthetic-window',
  );
  expect(f.auditRows).toEqual([]);
});

it('a close failure during commit cleanup preserves the original error', async () => {
  const f = fixture();
  const commitError = new Error('synthetic commit failure');
  f.transaction.commitError = commitError;
  f.closeWindow.mockRejectedValue(new Error('synthetic close failure'));
  await expect(f.open.execute({ pin, session })).rejects.toBe(commitError);
  expect(f.closeWindow).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({ sessionId: 'synthetic-session' }),
    'synthetic-window',
  );
});

it('a proof older than its age cannot open a window', async () => {
  const f = fixture();
  f.provePin.mockImplementation(async () => {
    f.clock.at = new Date(f.clock.at.getTime() + PROOF_MAX_AGE_MS + 1);
    return proof;
  });
  expect(await f.open.execute({ pin, session })).toEqual({ kind: 'refused' });
  expect(f.record).not.toHaveBeenCalled();
});

it('the work above the concurrency limit is refused before any comparison', async () => {
  const f = fixture();
  let release = (): void => undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  f.provePin.mockImplementation(async () => {
    await gate;
    return null;
  });
  const running = Array.from({ length: 8 }, () => f.open.execute({ pin, session }));
  await expect(f.open.execute({ pin, session })).rejects.toThrow('STAFF_PIN_UNAVAILABLE');
  release();
  await Promise.all(running);
});
