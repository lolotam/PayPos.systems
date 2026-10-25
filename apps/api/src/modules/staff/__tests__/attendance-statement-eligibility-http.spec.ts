import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  attendanceStatementHttpFixture,
  resetStatementHttp,
  seedDefaultHours,
  sendStatementRequest,
  statementBody,
  statementRows,
  type AttendanceStatementHttpFixture,
} from './attendance-statement-http.fixture.ts';
import {
  seedOpenStatementSession,
  seedStatementEmployee,
  seedStatementLeave,
  seedStatementSession,
  seedStatementShift,
} from './attendance-statement-http-seed.fixture.ts';

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

describe('the employee admission', () => {
  it('an employee with a counted session in the period is admitted on the employee form', async () => {
    const employeeId = await seedStatementEmployee(f, { name: 'Synthetic session employee' });
    await seedStatementSession(f, employeeId, '2026-10-05');
    const response = await sendStatementRequest(
      f,
      statementBody({ form: 'EMPLOYEE', employee_id: employeeId }),
    );
    expect(response.status).toBe(202);
    const rows = await statementRows(f);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ form: 'EMPLOYEE', employee_id: employeeId });
  });

  it('an upper-case employee id of an eligible employee is admitted and stored lower case', async () => {
    const employeeId = await seedStatementEmployee(f, { name: 'Synthetic upper case employee' });
    await seedStatementSession(f, employeeId, '2026-10-05');
    const response = await sendStatementRequest(
      f,
      statementBody({
        form: 'EMPLOYEE',
        employee_id: employeeId.toUpperCase(),
      }),
    );
    expect(response.status).toBe(202);
    const rows = await statementRows(f);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ employee_id: employeeId });
  });

});

describe('the employee scope refusals', () => {
  it('an employee of another business or company is refused', async () => {
    const otherBusiness = await seedStatementEmployee(f, {
      businessId: f.secondBusiness,
      branchId: f.otherBranch,
      name: 'Synthetic other business employee',
    });
    const otherCompany = await seedStatementEmployee(f, {
      companyId: f.otherCompany,
      businessId: f.foreignBusiness,
      branchId: f.foreignBranch,
      name: 'Synthetic other company employee',
    });
    for (const employeeId of [otherBusiness, otherCompany]) {
      const response = await sendStatementRequest(
        f,
        statementBody({ form: 'EMPLOYEE', employee_id: employeeId }),
      );
      expect(response.status).toBe(404);
      expect(response.body).toMatchObject({ code: 'ATTENDANCE_STATEMENT_EMPLOYEE_NOT_FOUND' });
    }
    expect(await statementRows(f)).toHaveLength(0);
  });

  it('an employee with no coverage at the branch in the period is refused', async () => {
    const employeeId = await seedStatementEmployee(f, {
      hireDate: '2026-11-01',
      name: 'Synthetic future employee',
    });
    const response = await sendStatementRequest(
      f,
      statementBody({ form: 'EMPLOYEE', employee_id: employeeId }),
    );
    expect(response.status).toBe(404);
    expect(response.body).toMatchObject({ code: 'ATTENDANCE_STATEMENT_EMPLOYEE_NOT_FOUND' });
  });

  it('an employee whose only activity is an open session is refused', async () => {
    const employeeId = await seedStatementEmployee(f, { name: 'Synthetic open session employee' });
    await seedOpenStatementSession(f, employeeId, '2026-10-05');
    const response = await sendStatementRequest(
      f,
      statementBody({ form: 'EMPLOYEE', employee_id: employeeId }),
    );
    expect(response.status).toBe(404);
    expect(response.body).toMatchObject({ code: 'ATTENDANCE_STATEMENT_EMPLOYEE_NOT_FOUND' });
  });
});

describe('the coverage of the period', () => {
  it('an employee with only contracted minutes on a day that ended is admitted', async () => {
    const response = await sendStatementRequest(
      f,
      statementBody({ form: 'EMPLOYEE', employee_id: f.employee.id }),
    );
    expect(response.status).toBe(202);
  });

  it('a period of only future dates with no leave is refused', async () => {
    const response = await sendStatementRequest(
      f,
      statementBody({
        form: 'EMPLOYEE',
        employee_id: f.employee.id,
        from: '2026-10-25',
        to: '2026-10-31',
      }),
    );
    expect(response.status).toBe(404);
    expect(response.body).toMatchObject({ code: 'ATTENDANCE_STATEMENT_EMPLOYEE_NOT_FOUND' });
  });
});

describe('the cutoff rules', () => {
  it('an employee hired today with a 17:00 entry is refused at 10:00 and admitted at 23:30', async () => {
    const employeeId = await seedStatementEmployee(f, {
      hireDate: '2026-10-23',
      name: 'Synthetic hired today employee',
    });
    await seedDefaultHours(f, employeeId, [{ day: 6, start: '17:00', end: '21:00' }]);
    const refused = await sendStatementRequest(
      f,
      statementBody({ form: 'EMPLOYEE', employee_id: employeeId }),
    );
    expect(refused.status).toBe(404);
    expect(refused.body).toMatchObject({ code: 'ATTENDANCE_STATEMENT_EMPLOYEE_NOT_FOUND' });
    f.control.now = new Date('2026-10-23T20:30:00.000Z');
    const accepted = await sendStatementRequest(
      f,
      statementBody({ form: 'EMPLOYEE', employee_id: employeeId }),
    );
    expect(accepted.status).toBe(202);
  });

  it('the same employee with an approved leave on the hiring day is admitted at 10:00', async () => {
    const employeeId = await seedStatementEmployee(f, {
      hireDate: '2026-10-23',
      name: 'Synthetic leave today employee',
    });
    await seedDefaultHours(f, employeeId, [{ day: 6, start: '17:00', end: '21:00' }]);
    await seedStatementLeave(f, employeeId, '2026-10-23');
    const response = await sendStatementRequest(
      f,
      statementBody({ form: 'EMPLOYEE', employee_id: employeeId }),
    );
    expect(response.status).toBe(202);
  });

  it('an ended scheduled shift admits the employee and a later one does not', async () => {
    const ended = await seedStatementEmployee(f, { name: 'Synthetic ended shift employee' });
    await seedStatementShift(f, ended, { workingDate: '2026-10-23', start: '08:00', end: '09:30' });
    const accepted = await sendStatementRequest(
      f,
      statementBody({ form: 'EMPLOYEE', employee_id: ended }),
    );
    expect(accepted.status).toBe(202);
    const later = await seedStatementEmployee(f, { name: 'Synthetic later shift employee' });
    await seedStatementShift(f, later, { workingDate: '2026-10-23', start: '17:00', end: '21:00' });
    const refused = await sendStatementRequest(
      f,
      statementBody({ form: 'EMPLOYEE', employee_id: later }),
    );
    expect(refused.status).toBe(404);
    expect(refused.body).toMatchObject({ code: 'ATTENDANCE_STATEMENT_EMPLOYEE_NOT_FOUND' });
  });
});

describe('the branch form with an employee filter', () => {
  it('the branch form applies the same coverage rules', async () => {
    const covered = await seedStatementEmployee(f, { name: 'Synthetic branch filter employee' });
    await seedStatementSession(f, covered, '2026-10-05');
    const accepted = await sendStatementRequest(f, statementBody({ employee_id: covered }));
    expect(accepted.status).toBe(202);
    const uncovered = await seedStatementEmployee(f, {
      hireDate: '2026-11-01',
      name: 'Synthetic branch filter refused',
    });
    const refused = await sendStatementRequest(f, statementBody({ employee_id: uncovered }));
    expect(refused.status).toBe(404);
    expect(refused.body).toMatchObject({ code: 'ATTENDANCE_STATEMENT_EMPLOYEE_NOT_FOUND' });
  });

  it('the shift filter admits only the employees scheduled on that pair', async () => {
    const other = await seedStatementEmployee(f, { name: 'Synthetic other pair employee' });
    await seedDefaultHours(f, other, [{ day: 2, start: '09:00', end: '17:00' }]);
    await seedStatementShift(f, other, { workingDate: '2026-10-05', start: '08:00', end: '16:00' });
    await seedStatementLeave(f, other, '2026-10-05');
    await seedStatementSession(f, other, '2026-10-05', {
      scheduledEnd: '2026-10-05T13:00:00.000Z',
    });
    const refused = await sendStatementRequest(
      f,
      statementBody({
        employee_id: other,
        shift: { start: '09:00', end: '20:00' },
      }),
    );
    expect(refused.status).toBe(404);
    expect(refused.body).toMatchObject({ code: 'ATTENDANCE_STATEMENT_EMPLOYEE_NOT_FOUND' });
    const matching = await seedStatementEmployee(f, { name: 'Synthetic matching pair employee' });
    await seedStatementShift(f, matching, {
      workingDate: '2026-10-05',
      start: '09:00',
      end: '20:00',
    });
    const accepted = await sendStatementRequest(
      f,
      statementBody({
        employee_id: matching,
        shift: { start: '09:00', end: '20:00' },
      }),
    );
    expect(accepted.status).toBe(202);
  });
});
