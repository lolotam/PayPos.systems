import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';

import {
  attendanceStatementHttpFixture,
  resetStatementHttp,
  sendStatementRequest,
  statementBody,
  statementRows,
  type AttendanceStatementHttpFixture,
} from './attendance-statement-http.fixture.ts';
import { salaryIds } from './salary.fixture.ts';

let f: AttendanceStatementHttpFixture;
beforeAll(async () => {
  f = await attendanceStatementHttpFixture();
});
afterAll(async () => {
  await f?.db.close();
  await f?.h.close();
});
beforeEach(async () => {
  await resetStatementHttp(f);
});

it('an inverted period is refused with no row and no job', async () => {
  const response = await sendStatementRequest(
    f,
    statementBody({ from: '2026-10-31', to: '2026-10-01' }),
  );
  expect(response.status).toBe(422);
  expect(response.body).toMatchObject({ code: 'ATTENDANCE_STATEMENT_PERIOD_INVALID' });
  expect(await statementRows(f)).toHaveLength(0);
  expect(f.control.queued).toHaveLength(0);
});

it('a 367-day period is refused while a 366-day period in the current month is accepted', async () => {
  const refused = await sendStatementRequest(
    f,
    statementBody({ from: '2025-10-30', to: '2026-10-31' }),
  );
  expect(refused.status).toBe(422);
  expect(refused.body).toMatchObject({ code: 'ATTENDANCE_STATEMENT_PERIOD_INVALID' });
  const accepted = await sendStatementRequest(
    f,
    statementBody({ from: '2025-10-31', to: '2026-10-31' }),
  );
  expect(accepted.status).toBe(202);
  expect(await statementRows(f)).toHaveLength(1);
});

it('a period past the last day of the current month is refused', async () => {
  const response = await sendStatementRequest(f, statementBody({ to: '2026-11-30' }));
  expect(response.status).toBe(422);
  expect(response.body).toMatchObject({ code: 'ATTENDANCE_STATEMENT_PERIOD_INVALID' });
  expect(await statementRows(f)).toHaveLength(0);
});

it('the month ceiling turns at Kuwait midnight, not at the UTC midnight', async () => {
  f.control.now = new Date('2026-10-31T20:59:00.000Z');
  const before = await sendStatementRequest(f, statementBody({ to: '2026-11-30' }));
  expect(before.status).toBe(422);
  expect(before.body).toMatchObject({ code: 'ATTENDANCE_STATEMENT_PERIOD_INVALID' });
  f.control.now = new Date('2026-10-31T21:00:00.000Z');
  const after = await sendStatementRequest(f, statementBody({ to: '2026-11-30' }));
  expect(after.status).toBe(202);
  const december = await sendStatementRequest(f, statementBody({ to: '2026-12-01' }));
  expect(december.status).toBe(422);
  expect(december.body).toMatchObject({ code: 'ATTENDANCE_STATEMENT_PERIOD_INVALID' });
});

it('a branch without its own time zone follows the business time zone', async () => {
  const businessId = salaryIds.newId();
  const branchId = salaryIds.newId();
  await f.h.owner`INSERT INTO businesses(company_id,id,name_en,vertical_type,timezone)
    VALUES(${f.company},${businessId},'Synthetic dubai business','salon','Asia/Dubai')`;
  await f.h.owner`INSERT INTO branches(company_id,id,business_id,name_en)
    VALUES(${f.company},${branchId},${businessId},'Synthetic dubai branch')`;
  f.control.now = new Date('2026-10-31T20:00:00.000Z');
  const kuwait = await sendStatementRequest(f, statementBody({ to: '2026-11-30' }));
  expect(kuwait.status).toBe(422);
  const dubai = await sendStatementRequest(f, statementBody({ to: '2026-11-30' }), {
    businessId,
    branchId,
  });
  expect(dubai.status).toBe(202);
});

it('a shift on the branch form is accepted and stored as a time', async () => {
  const response = await sendStatementRequest(
    f,
    statementBody({ shift: { start: '09:00', end: '20:00' } }),
  );
  expect(response.status).toBe(202);
  const rows = await statementRows(f);
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ shift_start: '09:00:00', shift_end: '20:00:00' });
});

it('a shift on the employee form is refused with no row', async () => {
  const response = await sendStatementRequest(
    f,
    statementBody({
      form: 'EMPLOYEE',
      employee_id: f.employee.id,
      shift: { start: '09:00', end: '20:00' },
    }),
  );
  expect(response.status).toBe(422);
  expect(response.body).toMatchObject({ code: 'ATTENDANCE_STATEMENT_SHIFT_FILTER_INVALID' });
  expect(await statementRows(f)).toHaveLength(0);
  expect(f.control.queued).toHaveLength(0);
});
