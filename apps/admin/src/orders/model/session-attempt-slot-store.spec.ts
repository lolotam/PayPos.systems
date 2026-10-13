import { afterEach, expect, it, vi } from 'vitest';
import type { createSessionAttemptJournal } from './session-attempt-journal';
import type { JournalStorage } from './session-attempt-slot-store';
import { freezeSessionAttempt, type SessionJournalEnvelope } from './session-attempt';

const id = (n: number) => `01920000-0000-7000-8000-${n.toString().padStart(12, '0')}`;
const scope = { companyId: id(1), businessId: id(2), branchId: id(3), userId: id(4) };
const keys = ['pospay:service-session-attempt:a', 'pospay:service-session-attempt:b', 'pospay:service-session-attempt'] as const;
const partial: SessionJournalEnvelope = { version: 1, state: 'PARTIAL', scope, sessionId: id(12) };
const lines = [{ service_id: id(5), price: '7.125', discount: { kind: 'AMOUNT' as const, amount: '0.000' }, performers: [{ employee_id: id(6) }] }];
const command = { kind: 'append' as const, sessionId: id(12), body: { lines } };
const record = { kind: 'record' as const, body: { customer_id: id(7), lines } };
let counter = 100;
const runtime = { now: () => Date.parse('2026-10-13T08:00:00.000Z'), newId: vi.fn(() => id(++counter)) };
const journals: ReturnType<typeof createSessionAttemptJournal>[] = [];
function seed(envelope: SessionJournalEnvelope | { version: 1; state: 'IDLE' }, generation = 1, index = 0) {
  const key = keys[index]; if (!key) throw new Error('Invalid slot index'); sessionStorage.setItem(key, JSON.stringify({ generation, envelope }));
}
async function reload(backing?: JournalStorage, place = scope) {
  const snapshot = keys.map((key) => [key, sessionStorage.getItem(key)] as const);
  journals.forEach((journal) => { journal.changeScope(null); journal.dispose(); }); sessionStorage.clear();
  snapshot.forEach(([key, raw]) => { if (raw) sessionStorage.setItem(key, raw); });
  vi.resetModules(); const { createSessionAttemptJournal: create } = await import('./session-attempt-journal');
  const journal = create(place, runtime, backing); journals.push(journal); return journal;
}
afterEach(() => { journals.splice(0).forEach((journal) => { journal.changeScope(null); journal.dispose(); }); sessionStorage.clear(); runtime.newId.mockClear(); });

it.each(['throw', 'silent', 'mismatch'])('keeps the verified PARTIAL through an append %s failure and a fresh-module reload', async (failure) => {
  seed(partial); const previous = sessionStorage.getItem(keys[0]);
  const backing = { getItem: (key: string) => sessionStorage.getItem(key), removeItem: (key: string) => sessionStorage.removeItem(key),
    setItem(key: string, raw: string) { if (failure === 'throw') throw new Error('Quota'); if (failure === 'mismatch') sessionStorage.setItem(key, '{'); else if (failure !== 'silent') sessionStorage.setItem(key, raw); } };
  const journal = await reload(backing), send = vi.fn();
  expect(() => { const attempt = journal.begin(command, [id(9)]); void journal.run(attempt, send); }).toThrow('SESSION_ATTEMPT_NOT_PERSISTED');
  expect(send).not.toHaveBeenCalled(); expect(journal.read()).toEqual(partial); expect(journal.persistenceWarning).toBe('NOT_PERSISTED');
  expect(sessionStorage.getItem(keys[0])).toBe(previous);
  const recovered = await reload(); expect(recovered.read()).toEqual(partial); expect(() => recovered.begin(record, [id(9)])).toThrow();
});

it('recovers an exactly surviving unverified PENDING conservatively when read-back threw', async () => {
  seed(partial); let written = false;
  const backing = { getItem(key: string) { if (written && key === keys[1]) throw new Error('Read denied'); return sessionStorage.getItem(key); },
    setItem(key: string, raw: string) { sessionStorage.setItem(key, raw); written = true; }, removeItem: (key: string) => sessionStorage.removeItem(key) };
  const journal = await reload(backing), previous = sessionStorage.getItem(keys[0]);
  expect(() => journal.begin(command, [id(9)])).toThrow('NOT_PERSISTED'); expect(journal.read()).toEqual(partial);
  expect(sessionStorage.getItem(keys[0])).toBe(previous);
  const candidate = JSON.parse(sessionStorage.getItem(keys[1]) ?? 'null').envelope;
  const recovered = await reload(); expect(recovered.read()).toEqual(candidate); expect(candidate.attempt.kind).toBe('append');
  expect(() => recovered.begin(record, [id(9)])).toThrow('UNRESOLVED'); expect(runtime.newId).toHaveBeenCalledTimes(1);
});

it('keeps both slots when retiring PARTIAL fails and recovers the newer append PENDING', async () => {
  seed(partial);
  const backing = { getItem: (key: string) => sessionStorage.getItem(key), setItem: (key: string, raw: string) => sessionStorage.setItem(key, raw), removeItem() { throw new Error('Remove denied'); } };
  const journal = await reload(backing), previous = sessionStorage.getItem(keys[0]);
  const attempt = journal.begin(command, [id(9)]); expect(journal.persistenceWarning).toBeNull();
  expect(sessionStorage.getItem(keys[0])).toBe(previous); expect(sessionStorage.length).toBe(2);
  const recovered = await reload(); expect(recovered.read()).toEqual({ version: 1, state: 'PENDING', attempt });
  expect(() => recovered.begin(command, [id(9)])).toThrow('UNRESOLVED');
});

it.each([0, 1])('recovers the newest valid generation regardless of slot order (%s)', async (newest) => {
  seed(partial, 3, 1 - newest); seed({ ...partial, sessionId: id(99) }, 8, newest);
  expect((await reload()).read()).toEqual({ ...partial, sessionId: id(99) });
});

it('writes a verified tombstone, survives older-slot retirement failure, and increases generations after reload', async () => {
  seed(partial, 7, 1);
  const backing = { getItem: (key: string) => sessionStorage.getItem(key), setItem: (key: string, raw: string) => sessionStorage.setItem(key, raw), removeItem() { throw new Error('Remove denied'); } };
  const journal = await reload(backing); journal.leaveVisit();
  expect(JSON.parse(sessionStorage.getItem(keys[0]) ?? 'null')).toEqual({ generation: 8, envelope: { version: 1, state: 'IDLE' } });
  expect(sessionStorage.length).toBe(2); const recovered = await reload(); expect(recovered.read()).toBeNull();
  recovered.begin(record, [id(9)]); expect(JSON.parse(sessionStorage.getItem(keys[1]) ?? 'null').generation).toBe(9);
});

it('preserves PARTIAL when the idle tombstone cannot be verified', async () => {
  seed(partial);
  const backing = { getItem: (key: string) => sessionStorage.getItem(key), setItem() {}, removeItem: (key: string) => sessionStorage.removeItem(key) };
  const journal = await reload(backing); expect(() => journal.leaveVisit()).toThrow('NOT_PERSISTED');
  expect(journal.read()).toEqual(partial); expect((await reload()).read()).toEqual(partial);
});

it.each(['unreadable', 'ambiguous'])('blocks new creation for %s storage instead of treating it as empty', async (failure) => {
  seed({ version: 1, state: 'IDLE' }); if (failure === 'ambiguous') seed(partial, 1, 1);
  const backing = { getItem(key: string) { if (failure === 'unreadable' && key === keys[1]) throw new Error('Read denied'); return sessionStorage.getItem(key); },
    setItem: (key: string, raw: string) => sessionStorage.setItem(key, raw), removeItem: (key: string) => sessionStorage.removeItem(key) };
  const journal = await reload(backing); expect(journal.persistenceWarning).toBe('NOT_PERSISTED');
  expect(() => journal.begin(record, [id(9)])).toThrow('SESSION_ATTEMPT_NOT_PERSISTED'); expect(runtime.newId).not.toHaveBeenCalled();
});

it('keeps corrupt-slot recovery blocked, validates generation fields and purges unknown PII', async () => {
  seed(partial); sessionStorage.setItem(keys[1], JSON.stringify({ generation: 2, envelope: { version: 1, state: 'IDLE' }, phone: 'synthetic PII' }));
  const journal = await reload(); expect(journal.read()).toEqual(partial); expect(journal.persistenceWarning).toBe('NOT_PERSISTED');
  expect(sessionStorage.getItem(keys[1])).toBeNull(); expect(() => journal.begin(command, [id(9)])).toThrow('NOT_PERSISTED');
});

it('migrates a legacy PENDING without changing its key and retires it only after verification', async () => {
  const attempt = freezeSessionAttempt(scope, record, [id(9)], runtime);
  sessionStorage.setItem(keys[2], JSON.stringify({ version: 1, state: 'PENDING', attempt }));
  const journal = await reload(); expect(journal.read()).toEqual({ version: 1, state: 'PENDING', attempt });
  await expect(journal.run(attempt, async () => { throw new TypeError('Response lost'); })).rejects.toThrow();
  expect(sessionStorage.getItem(keys[2])).toBeNull(); expect((await reload()).read()).toMatchObject({ state: 'PENDING', attempt });
  expect(runtime.newId).toHaveBeenCalledTimes(1);
});

it('purges foreign actor/scope slots before allowing a new creation', async () => {
  seed(partial); seed({ ...partial, sessionId: id(99) }, 2, 1);
  const journal = await reload(undefined, { ...scope, userId: id(98) }); expect(journal.read()).toBeNull(); expect(sessionStorage.length).toBe(0);
  expect(journal.begin(record, [id(9)]).scope.userId).toBe(id(98));
});
