import { afterAll, beforeAll, expect, it } from 'vitest';

import { branchPlaceAdapter } from '../persistence/branch-place.adapter.ts';
import { statementIdentityReader } from '../persistence/attendance-statement-identity.ts';
import { attendanceStatementTransactions } from '../persistence/attendance-statement.transactions.ts';
import { attendanceStatementOpenSessions } from '../queries/attendance-statement-open-sessions.query.ts';
import { ReadAttendanceStatement } from '../use-cases/read-attendance-statement/read-attendance-statement.ts';
import {
  attendanceStatementFixture,
  type AttendanceStatementFixture,
} from './attendance-statement.fixture.ts';

let f: AttendanceStatementFixture;
beforeAll(async () => {
  f = await attendanceStatementFixture();
});
afterAll(async () => {
  await f?.close();
});

const WORKING = '2026-10-01';
const SHIFT_START = new Date('2026-10-01T06:00:00.000Z');
const SHIFT_END = new Date('2026-10-01T14:00:00.000Z');

it('FR-011a: a session closed between the two reads shows once, as a closed session', async () => {
  const tenant = await f.tenant();
  const sara = await f.employee(tenant, { nameEn: 'Sara' });
  const sessionId = await f.session(tenant, sara, { workingDate: WORKING, clockIn: SHIFT_START });
  const renderId = await f.request(tenant, { form: 'EMPLOYEE', employeeId: sara });
  // القارئ المغلق بيقفل الجلسة في معاملة تانية مقفولة بعد ما جملة الجلسات المفتوحة رجعت،
  // فجملة 27b اللي جاية بتشوفها مقفولة: ده بالظبط سباق القراءةين (FR-011a).
  const useCase = new ReadAttendanceStatement(
    attendanceStatementTransactions(
      f.db,
      statementIdentityReader,
      branchPlaceAdapter,
      async (tx, companyId, branchId, employeeId, from, to) => {
        const sessions = await attendanceStatementOpenSessions(
          tx,
          companyId,
          branchId,
          employeeId,
          from,
          to,
        );
        await f.closeSession(tenant, sessionId, SHIFT_END);
        return sessions;
      },
    ),
  );
  const result = await useCase.execute(tenant.company, renderId);
  expect(result.kind).toBe('READY');
  if (result.kind !== 'READY') return;
  const statement = result.data.statement;
  if (statement.form !== 'EMPLOYEE') throw new Error('STATEMENT_NOT_EMPLOYEE');
  const day = statement.days.find((entry) => entry.date === WORKING);
  expect(day?.still_in).toBe(false);
  expect(day?.worked_minutes).toBe(480);
  expect(day?.sessions).toHaveLength(1);
  expect(day?.sessions[0]?.counted).toBe(true);
});
