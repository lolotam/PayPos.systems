import { vi } from 'vitest';
import type * as StaffModule from '../staff.module.ts';
import type { Tx } from '@pospay/db';
import { sql } from 'drizzle-orm';
import type {
  AttendanceChangeApplyScope,
  AttendanceChangeKinds,
  AttendanceChangeKind,
} from '../ports/attendance-change-kinds.port.ts';
import {
  ATTENDANCE_CHANGE_KINDS,
  AttendanceChangeKindRefusal,
} from '../ports/attendance-change-kinds.port.ts';
import { AttendanceChangeError } from '../domain/attendance-change-request.ts';
import { createAttendanceChangeKinds } from '../persistence/attendance-change-kinds.ts';
import { createAddSessionKind } from '../persistence/add-session-kind.ts';
import { createAttendanceChangeTransactions } from '../persistence/drizzle-attendance-change-transactions.ts';
import { RequestAttendanceChangeUseCase } from '../use-cases/request-attendance-change/request-attendance-change.usecase.ts';
import { CancelAttendanceChangeUseCase } from '../use-cases/cancel-attendance-change/cancel-attendance-change.usecase.ts';
import { DecideAttendanceChangeUseCase } from '../use-cases/decide-attendance-change/decide-attendance-change.usecase.ts';
import { attendanceCorrectionFixture, ownerUserId } from './attendance-correction.fixture.ts';
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
  const control = {
    refuse: false,
    failAfterEffect: false,
    kindRefusal: false,
    kindRefusalAfterEffect: false,
    nullSession: false,
  };
  const kinds = createAttendanceChangeKinds(
    production
      ? [createAddSessionKind(leaveIds)]
      : ['ADD_SESSION', 'VOID_SESSION'].map((code) =>
          testKind(code as AttendanceChangeKind['code'], control),
        ),
  );
  override.current = production ? null : kinds;
  const f = await attendanceCorrectionFixture();
  override.current = null;
  const owner = await ownerUserId(f);
  await f.h
    .owner`CREATE TABLE test_attendance_change_effects(company_id uuid NOT NULL, id uuid NOT NULL,
    request_id uuid NOT NULL, PRIMARY KEY(company_id,id),
    FOREIGN KEY(company_id,request_id) REFERENCES attendance_change_requests(company_id,id))`;
  await f.h.owner`GRANT SELECT, INSERT ON test_attendance_change_effects TO pospay_app`;
  const tx = createAttendanceChangeTransactions(f.db, leaveIds, kinds);
  return {
    ...f,
    owner,
    control,
    kinds,
    tx,
    fileChange: new RequestAttendanceChangeUseCase(tx, f.clock, kinds, leaveIds),
    cancelChange: new CancelAttendanceChangeUseCase(tx, f.clock),
    decideChange: new DecideAttendanceChangeUseCase(tx, f.clock, kinds),
  };
}
export type ChangeFixture = Awaited<ReturnType<typeof attendanceChangeFixture>>;
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
  branch_id: f.branch,
  clock_in: '2026-10-03T07:00:00.000Z',
  clock_out: '2026-10-03T16:00:00.000Z',
  reason: '  missing attendance  ',
});
export const changeAudits = (f: ChangeFixture, id: string) =>
  f.h
    .owner`SELECT action,before,after FROM audit_log WHERE entity='attendance_change_request' AND entity_id=${id} ORDER BY id`;
export const changeEvents = (f: ChangeFixture, id: string) =>
  f.h.owner`SELECT event_type,payload FROM outbox WHERE aggregate_id=${id} ORDER BY id`;
export const effectCount = (f: ChangeFixture) =>
  f.h.owner`SELECT request_id FROM test_attendance_change_effects ORDER BY id`;

function testKind(
  code: AttendanceChangeKind['code'],
  control: {
    refuse: boolean;
    failAfterEffect: boolean;
    kindRefusal: boolean;
    kindRefusalAfterEffect: boolean;
    nullSession: boolean;
  },
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
      if (control.kindRefusal && scope.request)
        throw new AttendanceChangeKindRefusal('TEST_KIND_REFUSED', 422);
      if (control.refuse) throw new AttendanceChangeError('VALIDATION_FAILED');
      return {
        ...(code === 'ADD_SESSION'
          ? {
              manual: {
                clock_in: scope.input.clock_in ?? '',
                clock_out: scope.input.clock_out ?? '',
                working_date: '2026-10-03',
                timezone: 'Asia/Kuwait',
              },
            }
          : {}),
        session_id: scope.input.session_id ?? null,
        session_revision: scope.input.session_revision ?? null,
      };
    },
    apply: async (scope, values) => {
      await (scope.transaction as Tx).execute(
        sql`INSERT INTO test_attendance_change_effects(company_id,id,request_id) VALUES(${scope.companyId},${leaveIds.newId()},${scope.requestId})`,
      );
      if (control.failAfterEffect) throw new AttendanceChangeError('VALIDATION_FAILED');
      if (control.kindRefusalAfterEffect)
        throw new AttendanceChangeKindRefusal('TEST_KIND_REFUSED', 422);
      if (control.nullSession) return { ...values, session_id: null };
      return code === 'ADD_SESSION' && !values.session_id
        ? { ...values, session_id: await testManualSession(scope) }
        : values;
    },
  };
}
// الـ CHECK attendance_change_requests_add_linked يطلب جلسة لكل ADD معتمد، فنوع الاختبار يكتب جلسة يدوية مربوطة.
async function testManualSession(scope: AttendanceChangeApplyScope) {
  const id = leaveIds.newId();
  const day = (scope.input.clock_in ?? '2026-10-03T07:00:00.000Z').slice(0, 10);
  await (scope.transaction as Tx).execute(
    sql`INSERT INTO attendance_sessions(company_id,id,business_id,branch_id,employee_id,working_date,timezone,clock_in,clock_out,status,source,closed_by,geo,late_minutes,change_request_id)
      VALUES(${scope.companyId},${id},${scope.businessId},${scope.target.branch_id},${scope.target.employee_id},${day},'Asia/Kuwait',
        ${scope.input.clock_in ?? `${day}T07:00:00.000Z`},${scope.input.clock_out ?? `${day}T16:00:00.000Z`},'CLOSED','MANUAL','MANUAL','NONE',0,${scope.requestId})`,
  );
  return id;
}
