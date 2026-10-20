import { expect, it } from 'vitest';
import { ascendingEmployeeIds, employeeIdBatches } from '../domain/employee-order.ts';
import type { SessionTipsTransaction } from '../ports/session-tips.port.ts';
import { RecordSessionTipsUseCase } from '../use-cases/record-session-tips/record-session-tips.usecase.ts';

const AT = new Date('2026-10-15T08:00:00.000Z');
const MEMBERSHIP = '00000000-0000-7000-8000-000000000001';
const SESSION = '00000000-0000-7000-8000-000000000002';

type PerformerCall = { kind: 'lock' | 'read'; ids: readonly string[] };

function batchPort(calls: PerformerCall[], retained: readonly string[] = []): SessionTipsTransaction {
  const access = { record: true, denied: false, feature: true, membership_ids: [MEMBERSHIP] };
  const session = {
    id: SESSION,
    business_id: MEMBERSHIP,
    branch_id: MEMBERSHIP,
    occurred_at: AT,
    business_date: '2026-10-15',
    business_timezone: 'Asia/Kuwait',
  };
  return {
    place: { read: async () => ({ timezone: 'Asia/Kuwait' }) },
    access: { lock: async () => undefined, read: async () => access },
    performers: {
      lock: async (batch) => {
        calls.push({ kind: 'lock', ids: [...batch] });
      },
      read: async (batch) => {
        calls.push({ kind: 'read', ids: [...batch] });
        return [];
      },
    },
    tips: {
      lockVisit: async () => undefined,
      loadSession: async () => session,
      loadPeople: async () => [],
      loadCurrent: async () => ({ revision: 0, entries: [] }),
      insertRevision: () => Promise.reject(new Error('insertRevision')),
    },
    identities: {
      retainedForLine: async () => [],
      retainedForSession: async () =>
        retained.map((employee_id) => ({ employee_id, linked_user_id: null, linked_user_snapshotted: true })),
    },
    idempotent: async (handler) => ({ body: await handler(), replayed: false }),
    audit: async () => undefined,
    emit: async () => undefined,
  };
}

it('locks 81 distinct performer ids in ascending batches before any read', async () => {
  // الترتيب التنازلي يكشف قفلاً يحفظ ترتيب الطلب بدل الترتيب التصاعدي
  const employeeIds = Array.from({ length: 81 }, (_, index) =>
    `00000000-0000-7000-8001-${(81 - index).toString(16).padStart(12, '0')}`,
  );
  const calls: PerformerCall[] = [];
  let next = 0;
  const tips = new RecordSessionTipsUseCase(
    { run: (_context, work) => work(batchPort(calls)) },
    {
      newId: () => `00000000-0000-7000-9000-${(next += 1).toString(16).padStart(12, '0')}`,
    },
    { now: () => AT },
  );
  const error = await tips
    .execute({
      companyId: MEMBERSHIP,
      userId: MEMBERSHIP,
      businessId: MEMBERSHIP,
      branchId: MEMBERSHIP,
      key: MEMBERSHIP,
      fingerprint: 'a'.repeat(64),
      sessionId: SESSION,
      input: {
        expected_revision: 0,
        tips: employeeIds.map((employee_id) => ({
          employee_id,
          method: 'CASH' as const,
          amount: '1.000',
        })),
      },
    })
    .then(
      () => null,
      (caught: unknown) => caught,
    );
  const batches = employeeIdBatches(ascendingEmployeeIds(employeeIds), 80);
  expect((error as { code?: string }).code).toBe('TIP_EMPLOYEE_NOT_PERFORMER');
  expect(calls.map((call) => call.kind)).toEqual(['lock', 'lock', 'read', 'read']);
  expect(calls.map((call) => [...call.ids])).toEqual([...batches, ...batches]);
});

it('a retained-only employee joins the lock set, and every lock runs before the first read', async () => {
  const retained = '00000000-0000-7000-8002-000000000001';
  const requested = '00000000-0000-7000-8003-000000000002';
  const calls: PerformerCall[] = [];
  const tips = new RecordSessionTipsUseCase(
    { run: (_context, work) => work(batchPort(calls, [retained])) },
    { newId: () => '00000000-0000-7000-9000-000000000001' },
    { now: () => AT },
  );
  await tips
    .execute({
      companyId: MEMBERSHIP,
      userId: MEMBERSHIP,
      businessId: MEMBERSHIP,
      branchId: MEMBERSHIP,
      key: MEMBERSHIP,
      fingerprint: 'a'.repeat(64),
      sessionId: SESSION,
      input: {
        expected_revision: 0,
        tips: [{ employee_id: requested, method: 'CASH' as const, amount: '1.000' }],
      },
    })
    .then(
      () => null,
      (caught: unknown) => caught,
    );
  const locks = calls.filter((call) => call.kind === 'lock');
  const locked = locks.flatMap((call) => [...call.ids]);
  expect(locked).toContain(retained);
  expect(locked).toContain(requested);
  expect(locked).toEqual([...locked].sort());
  expect(locks.every((call) => call.ids.length <= 80)).toBe(true);
  const kinds = calls.map((call) => call.kind);
  expect(kinds.lastIndexOf('lock')).toBeLessThan(kinds.indexOf('read'));
});
