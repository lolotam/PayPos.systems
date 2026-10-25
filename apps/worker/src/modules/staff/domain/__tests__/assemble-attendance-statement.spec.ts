import { expect, it } from 'vitest';
import type {
  ReportBranchInputs,
  ReportSession,
  ReportShift,
  StoredBusinessIdentity,
} from '@pospay/domain';
import type {
  AttendanceStatementData,
  AttendanceStatementNames,
  AttendanceStatementRead,
  AttendanceStatementRequestRow,
  AttendanceStatementRow,
  BranchStatementBody,
  EmployeeStatementBody,
  StatementInputs,
} from '../attendance-statement-data.ts';
import { assembleAttendanceStatement } from '../assemble-attendance-statement.ts';

const PERIOD = { from: '2026-10-01', to: '2026-10-03' };
// الساعة 10:00 بتوقيت الكويت في أول يوم من الفترة.
const CUTOFF = '2026-10-01T07:00:00.000Z';
const at = (date: string, time: string) => `${date}T${time}:00+03:00`;

const NAMES: AttendanceStatementNames = {
  business: { name_ar: 'صالون الأميرة', name_en: 'Princess Salon' },
  branch: { nameAr: 'السالمية', nameEn: 'Salmiya' },
  timezone: 'Asia/Kuwait',
};

const IDENTITY: StoredBusinessIdentity = {
  official_name_ar: 'صالون الأميرة',
  official_name_en: 'Princess Salon',
  logo_file_id: null,
};

function session(patch: Partial<ReportSession> = {}): ReportSession {
  return {
    working_date: '2026-10-01',
    clock_in: at('2026-10-01', '09:00'),
    clock_out: at('2026-10-01', '17:00'),
    status: 'CLOSED',
    source: 'QR',
    late_minutes: 0,
    scheduled_end: null,
    clock_out_corrected: false,
    voided: false,
    ...patch,
  };
}

function shift(patch: Partial<ReportShift> = {}): ReportShift {
  return {
    working_date: '2026-10-01',
    starts_at: at('2026-10-01', '09:00'),
    ends_at: at('2026-10-01', '17:00'),
    break_starts_at: null,
    break_ends_at: null,
    ...patch,
  };
}

function branch(patch: Partial<ReportBranchInputs> = {}): ReportBranchInputs {
  return {
    timezone: 'Asia/Kuwait',
    sessions: [],
    shifts: [],
    contract: null,
    leave_for_branch: [],
    ...patch,
  };
}

function row(patch: Partial<AttendanceStatementRow> = {}): AttendanceStatementRow {
  return {
    employee_id: 'e-1',
    name_ar: 'سارة',
    name_en: 'Sara',
    employee_number: 1,
    branches: [branch()],
    ...patch,
  };
}

function request(
  patch: Partial<AttendanceStatementRequestRow> = {},
): AttendanceStatementRequestRow {
  return {
    businessId: 'business-1',
    branchId: 'branch-1',
    form: 'BRANCH',
    employeeId: null,
    period: PERIOD,
    language: 'ar',
    shift: null,
    logoFileId: null,
    requesterUserId: 'user-1',
    requestedAt: CUTOFF,
    ...patch,
  };
}

function inputs(patch: Partial<StatementInputs> = {}): StatementInputs {
  return {
    request: request(),
    names: NAMES,
    identity: IDENTITY,
    reportRows: [],
    scheduledRows: [],
    openSessions: [],
    ...patch,
  };
}

function ready(result: AttendanceStatementRead): AttendanceStatementData {
  if (result.kind !== 'READY') throw new Error('STATEMENT_NOT_READY');
  return result.data;
}

function branchBody(result: AttendanceStatementRead): BranchStatementBody {
  const statement = ready(result).statement;
  if (statement.form !== 'BRANCH') throw new Error('STATEMENT_NOT_BRANCH');
  return statement;
}

function employeeBody(result: AttendanceStatementRead): EmployeeStatementBody {
  const statement = ready(result).statement;
  if (statement.form !== 'EMPLOYEE') throw new Error('STATEMENT_NOT_EMPLOYEE');
  return statement;
}

it('the branch form orders the rows by employee number', () => {
  const result = assembleAttendanceStatement(
    inputs({
      reportRows: [
        row({
          employee_id: 'e-7',
          name_en: 'Rim',
          employee_number: 7,
          branches: [branch({ sessions: [session()] })],
        }),
        row({
          employee_id: 'e-3',
          name_en: 'Hiba',
          employee_number: 3,
          branches: [branch({ sessions: [session()] })],
        }),
      ],
    }),
  );
  expect(branchBody(result).rows.map((entry) => entry.employeeNumber)).toEqual([3, 7]);
});

it('the employee filter keeps one employee and names her in the header', () => {
  const result = assembleAttendanceStatement(
    inputs({
      request: request({ employeeId: 'e-3' }),
      reportRows: [
        row({
          employee_id: 'e-7',
          name_ar: null,
          name_en: 'Rim',
          employee_number: 7,
          branches: [branch({ sessions: [session()] })],
        }),
        row({
          employee_id: 'e-3',
          name_ar: null,
          name_en: 'Hiba',
          employee_number: 3,
          branches: [branch({ sessions: [session()] })],
        }),
      ],
    }),
  );
  const statement = branchBody(result);
  expect(statement.rows.map((entry) => entry.employeeNumber)).toEqual([3]);
  expect(statement.employeeFilter).toEqual({ name: 'Hiba', employeeNumber: 3 });
});

it('the shift pair leaves the contracted hours and the difference empty', () => {
  const result = assembleAttendanceStatement(
    inputs({
      request: request({ shift: { start: '09:00', end: '17:00' } }),
      reportRows: [
        row({
          branches: [
            branch({
              sessions: [session({ scheduled_end: at('2026-10-01', '17:00') })],
              shifts: [shift()],
            }),
          ],
        }),
      ],
    }),
  );
  const statement = branchBody(result);
  expect(statement.shiftFilter).toEqual({ start: '09:00', end: '17:00' });
  expect(statement.rows[0]?.totals.contractedMinutes).toBeNull();
  expect(statement.rows[0]?.totals.differenceMinutes).toBeNull();
  expect(statement.rows[0]?.totals.workedMinutes).toBe(480);
});

it('an employee covered only by her schedule gets a row', () => {
  const result = assembleAttendanceStatement(
    inputs({
      scheduledRows: [
        row({
          branches: [
            branch({
              shifts: [
                shift({ starts_at: at('2026-10-01', '08:00'), ends_at: at('2026-10-01', '09:30') }),
              ],
            }),
          ],
        }),
      ],
    }),
  );
  expect(branchBody(result).rows.map((entry) => entry.employeeNumber)).toEqual([1]);
});

it('an employee without coverage gets no row', () => {
  const result = assembleAttendanceStatement(inputs({ reportRows: [row()] }));
  expect(result).toEqual({ kind: 'EMPTY' });
});

it('FR-013a: a shift that has not ended at the request adds no scheduled minutes', () => {
  const result = assembleAttendanceStatement(
    inputs({
      reportRows: [
        row({
          branches: [
            branch({
              sessions: [session()],
              shifts: [
                shift({ starts_at: at('2026-10-01', '17:00'), ends_at: at('2026-10-01', '21:00') }),
              ],
            }),
          ],
        }),
      ],
    }),
  );
  expect(branchBody(result).rows[0]?.totals.scheduledMinutes).toBe(0);
});

it('FR-013a: a shift that ended before the request counts its scheduled minutes', () => {
  const result = assembleAttendanceStatement(
    inputs({
      reportRows: [
        row({
          branches: [
            branch({
              sessions: [session()],
              shifts: [
                shift({ starts_at: at('2026-10-01', '08:00'), ends_at: at('2026-10-01', '09:30') }),
              ],
            }),
          ],
        }),
      ],
    }),
  );
  expect(branchBody(result).rows[0]?.totals.scheduledMinutes).toBe(90);
});

it('the employee form has one day per date and prints the open session as still in', () => {
  const result = assembleAttendanceStatement(
    inputs({
      request: request({ form: 'EMPLOYEE', employeeId: 'e-1' }),
      reportRows: [row({ branches: [branch({ sessions: [session()] })] })],
      openSessions: [{ working_date: '2026-10-02', clock_in: at('2026-10-02', '08:30') }],
    }),
  );
  const statement = employeeBody(result);
  expect(statement.days.map((day) => day.date)).toEqual(['2026-10-01', '2026-10-02', '2026-10-03']);
  expect(statement.days[1]).toMatchObject({ still_in: true, worked_minutes: 0 });
  expect(statement.days[0]).toMatchObject({ still_in: false, worked_minutes: 480 });
  expect(statement.totals.daysPresent).toBe(1);
});

it('FR-011a: a session that closed between the two reads counts as closed and not still in', () => {
  const result = assembleAttendanceStatement(
    inputs({
      request: request({ form: 'EMPLOYEE', employeeId: 'e-1' }),
      reportRows: [
        row({
          branches: [
            branch({
              sessions: [
                session({
                  working_date: '2026-10-02',
                  clock_in: '2026-10-02T05:30:00.000Z',
                  clock_out: at('2026-10-02', '17:00'),
                }),
              ],
            }),
          ],
        }),
      ],
      openSessions: [{ working_date: '2026-10-02', clock_in: at('2026-10-02', '08:30') }],
    }),
  );
  const statement = employeeBody(result);
  expect(statement.days[1]).toMatchObject({ still_in: false, worked_minutes: 510 });
});

it('FR-011a: a session that is still open stays still in', () => {
  const result = assembleAttendanceStatement(
    inputs({
      request: request({ form: 'EMPLOYEE', employeeId: 'e-1' }),
      reportRows: [row({ branches: [branch({ sessions: [session()] })] })],
      openSessions: [{ working_date: '2026-10-02', clock_in: '2026-10-02T05:30:00.000Z' }],
    }),
  );
  const statement = employeeBody(result);
  expect(statement.days[1]).toMatchObject({ still_in: true, worked_minutes: 0 });
});

it('an employee form without coverage is empty', () => {
  const result = assembleAttendanceStatement(
    inputs({
      request: request({ form: 'EMPLOYEE', employeeId: 'e-1' }),
      reportRows: [row()],
    }),
  );
  expect(result).toEqual({ kind: 'EMPTY' });
});

it('the names fall back from Arabic to English', () => {
  const arabic = assembleAttendanceStatement(
    inputs({
      request: request({ language: 'ar' }),
      reportRows: [
        row({ name_ar: null, name_en: 'Sara', branches: [branch({ sessions: [session()] })] }),
      ],
    }),
  );
  expect(branchBody(arabic).rows[0]?.name).toBe('Sara');
  expect(branchBody(arabic).branchName).toBe('السالمية');
  const english = assembleAttendanceStatement(
    inputs({
      request: request({ language: 'en' }),
      reportRows: [
        row({ name_ar: 'سارة', name_en: 'Sara', branches: [branch({ sessions: [session()] })] }),
      ],
    }),
  );
  expect(branchBody(english).rows[0]?.name).toBe('Sara');
  expect(branchBody(english).branchName).toBe('Salmiya');
  expect(branchBody(english).businessName).toBe('Princess Salon');
});

it('the data carries no id besides the business, the requester and the logo', () => {
  const data = ready(
    assembleAttendanceStatement(
      inputs({
        reportRows: [row({ branches: [branch({ sessions: [session()] })] })],
      }),
    ),
  );
  expect(Object.keys(data).sort()).toEqual([
    'businessId',
    'logoFileId',
    'requesterUserId',
    'statement',
  ]);
  expect(JSON.stringify(data.statement)).not.toContain('e-1');
});
