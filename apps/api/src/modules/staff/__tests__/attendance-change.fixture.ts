import { vi } from 'vitest';
import type * as StaffModule from '../staff.module.ts';
import { appendAuditLog, type Tx } from '@pospay/db';
import { sql } from 'drizzle-orm';
import type {
  AttendanceChangeKinds,
  AttendanceChangeKind,
} from '../ports/attendance-change-kinds.port.ts';
import { ATTENDANCE_CHANGE_KINDS } from '../ports/attendance-change-kinds.port.ts';
import { AttendanceChangeError } from '../domain/attendance-change-request.ts';
import { createAttendanceChangeKinds } from '../persistence/attendance-change-kinds.ts';
import { createAttendanceChangeTransactions } from '../persistence/drizzle-attendance-change-transactions.ts';
import { RequestAttendanceChangeUseCase } from '../use-cases/request-attendance-change/request-attendance-change.usecase.ts';
import { CancelAttendanceChangeUseCase } from '../use-cases/cancel-attendance-change/cancel-attendance-change.usecase.ts';
import { DecideAttendanceChangeUseCase } from '../use-cases/decide-attendance-change/decide-attendance-change.usecase.ts';
import {
  attendanceCorrectionFixture,
  ownerUserId,
  seedSession,
} from './attendance-correction.fixture.ts';
import { attendanceChangeProviders } from '../attendance-change.providers.ts';
import { leaveIds } from './leave.fixture.ts';

const override = vi.hoisted(() => ({ current: null as AttendanceChangeKinds | null }));
vi.mock('../staff.module.ts', async (original) => {
  const real = await original<typeof StaffModule>();
  return {
    ...real,
    staffProviders: (...args: Parameters<typeof real.staffProviders>) =>
      real
        .staffProviders(...args)
        .map((provider) =>
          override.current &&
          typeof provider === 'object' &&
          'provide' in provider &&
          provider.provide === ATTENDANCE_CHANGE_KINDS
            ? { provide: ATTENDANCE_CHANGE_KINDS, useValue: override.current }
            : provider,
        ),
  };
});

export async function attendanceChangeFixture(production = false) {
  const control = { refuse: false, failAfterEffect: false };
  const kinds = createAttendanceChangeKinds(
    ['ADD_SESSION', 'VOID_SESSION'].map((code) =>
      testKind(code as AttendanceChangeKind['code'], control),
    ),
  );
  override.current = production ? null : kinds;
  const f = await attendanceCorrectionFixture();
  override.current = null;
  const owner = await ownerUserId(f);
  const tx = createAttendanceChangeTransactions(f.db, leaveIds);
  const provider = attendanceChangeProviders(f.db, leaveIds).find(
    (entry) =>
      typeof entry === 'object' && 'provide' in entry && entry.provide === ATTENDANCE_CHANGE_KINDS,
  );
  const activeKinds =
    production && provider && typeof provider === 'object' && 'useValue' in provider
      ? (provider.useValue as AttendanceChangeKinds)
      : kinds;
  return {
    ...f,
    owner,
    control,
    kinds: activeKinds,
    tx,
    fileChange: new RequestAttendanceChangeUseCase(tx, f.clock, activeKinds),
    cancelChange: new CancelAttendanceChangeUseCase(tx, f.clock),
    decideChange: new DecideAttendanceChangeUseCase(tx, f.clock, activeKinds),
  };
}
export type ChangeFixture = Awaited<ReturnType<typeof attendanceChangeFixture>>;
export async function voidInput(f: ChangeFixture, patch: Parameters<typeof seedSession>[1] = {}) {
  const session_id = await seedSession(f, patch);
  const [row] = await f.h
    .owner`SELECT employee_id FROM attendance_sessions WHERE company_id=${f.company} AND id=${session_id}`;
  return {
    kind: 'VOID_SESSION' as const,
    employee_id: row?.employee_id as string,
    session_id,
    session_revision: patch.revision ?? 0,
    reason: 'wrong attendance day',
  };
}
export const voidRow = async (f: ChangeFixture, sessionId: string) => {
  const [row] = await f.h
    .owner`SELECT to_jsonb(s) AS record FROM attendance_sessions s WHERE company_id=${f.company} AND id=${sessionId}`;
  return row?.record as Record<string, unknown>;
};
export const voidAudits = (f: ChangeFixture, sessionId: string) =>
  f.h
    .owner`SELECT action,before,after FROM audit_log WHERE company_id=${f.company} AND entity='attendance_session' AND entity_id=${sessionId} AND action IN ('attendance_session.voided','attendance_session.restored') ORDER BY id`;
export const changeActor = (f: ChangeFixture, requestId?: string, userId = f.approverId) => ({
  companyId: f.company,
  businessId: f.business,
  userId,
  key: leaveIds.newId(),
  fingerprint: 'synthetic-change',
  ...(requestId === undefined ? {} : { requestId }),
});
export const changeInput = (f: ChangeFixture) => ({
  kind: 'ADD_SESSION' as const,
  employee_id: f.employee.id,
  reason: '  missing attendance  ',
});
export const changeAudits = (f: ChangeFixture, id: string) =>
  f.h
    .owner`SELECT action,before,after FROM audit_log WHERE entity='attendance_change_request' AND entity_id=${id} ORDER BY id`;
export const changeEvents = (f: ChangeFixture, id: string) =>
  f.h.owner`SELECT event_type,payload FROM outbox WHERE aggregate_id=${id} ORDER BY id`;
export const effectCount = (f: ChangeFixture) =>
  f.h.owner`SELECT id FROM audit_log WHERE entity='test_attendance_change_effect'`;

function testKind(
  code: AttendanceChangeKind['code'],
  control: { refuse: boolean; failAfterEffect: boolean },
): AttendanceChangeKind {
  return {
    code,
    target: async (scope) => {
      const tx = scope.transaction as Tx;
      const [row] = await tx.execute<{ employee_id: string; branch_id: string }>(
        scope.input.session_id
          ? sql`SELECT employee_id,branch_id FROM attendance_sessions WHERE company_id=${scope.companyId} AND business_id=${scope.businessId} AND id=${scope.input.session_id} AND employee_id=${scope.input.employee_id}`
          : sql`SELECT id AS employee_id,primary_branch_id AS branch_id FROM employees WHERE company_id=${scope.companyId} AND business_id=${scope.businessId} AND id=${scope.input.employee_id}`,
      );
      return row ?? null;
    },
    check: async (scope) => {
      if (control.refuse) throw new AttendanceChangeError('VALIDATION_FAILED');
      return {
        session_id: scope.input.session_id ?? null,
        session_revision: scope.input.session_revision ?? null,
      };
    },
    apply: async (scope, values) => {
      await appendAuditLog(scope.transaction as Tx, leaveIds.newId(), {
        entity: 'test_attendance_change_effect',
        entityId: scope.target.employee_id,
        action: 'test.kind.applied',
        after: { applied: true },
      });
      if (control.failAfterEffect) throw new AttendanceChangeError('VALIDATION_FAILED');
      return values;
    },
  };
}
