import { afterAll, beforeAll, expect, it } from 'vitest';
import { attendanceMonthlyReport } from '@pospay/contracts';
import { attendanceBoard } from '../queries/attendance-board.query.ts';
import { attendanceBoardFixture, type BoardFixture } from './attendance-board.fixture.ts';
import { seedSession } from './attendance-correction.fixture.ts';
import {
  monthlyReportFixture,
  reportHeaders,
  reportSession,
  reportUrl,
  type MonthlyReportFixture,
} from './attendance-monthly-report.fixture.ts';

let boardFx: BoardFixture;
let reportFx: MonthlyReportFixture;
beforeAll(async () => {
  boardFx = await attendanceBoardFixture();
  await seedSession(boardFx, {
    employeeId: boardFx.employee.id,
    workingDate: '2026-10-04',
    clockIn: '2026-10-04T05:00:00.000Z',
    clockOut: null,
    status: 'OPEN',
    closedBy: null,
    outGeo: null,
  });
  reportFx = await monthlyReportFixture();
  await reportSession(reportFx);
});
afterAll(async () => {
  await boardFx?.db.close();
  await boardFx?.h.close();
  await reportFx?.db.close();
  await reportFx?.h.close();
});

const readBoard = () =>
  boardFx.db.withTenant(boardFx.company, (tx) =>
    attendanceBoard(tx, boardFx.scope, boardFx.boardClock.now(), '2026-10-04'),
  );
const readReport = async (branch: string) => {
  const response = await reportFx.h.app.inject({
    method: 'GET',
    url: reportUrl(reportFx, branch),
    headers: reportHeaders(reportFx),
  });
  expect(response.statusCode).toBe(200);
  return attendanceMonthlyReport.parse(response.json());
};
const readCsv = async () => {
  const response = await reportFx.h.app.inject({
    method: 'GET',
    url: reportUrl(reportFx, reportFx.branch, true),
    headers: reportHeaders(reportFx),
  });
  expect(response.statusCode).toBe(200);
  return response.payload.replace(/^\uFEFF/, '');
};
const cell = (csv: string, line: number) => csv.split('\r\n')[line]?.split(',')[0];
const setNumber = async (value: 7 | null) => {
  await boardFx.h
    .owner`UPDATE employees SET employee_number = ${value} WHERE company_id=${boardFx.company} AND id=${boardFx.employee.id}`;
  await reportFx.h
    .owner`UPDATE employees SET employee_number = ${value} WHERE company_id=${reportFx.company} AND id=${reportFx.employee.id}`;
};

it('EN-15 board, monthly report and CSV carry the employee number and no phone, salary or IBAN', async () => {
  await setNumber(7);
  const shown = await readBoard();
  const onBoard = (rows: { employee_id: string; employee_number: number | null }[]) =>
    rows.filter((row) => row.employee_id === boardFx.employee.id);
  expect(onBoard(shown.in_now).map((row) => row.employee_number)).toEqual([7]);
  expect(onBoard(shown.sessions).map((row) => row.employee_number)).toEqual([7]);
  const branch = await readReport(reportFx.branch);
  const all = await readReport('all');
  expect(branch.rows).toMatchObject([{ employee_id: reportFx.employee.id, employee_number: 7 }]);
  expect(all.rows).toMatchObject([{ employee_id: reportFx.employee.id, employee_number: 7 }]);
  const csv = await readCsv();
  expect(cell(csv, 0)).toBe('"رقم الموظف"');
  expect(cell(csv, 1)).toBe('"7"');
  expect(csv).not.toMatch(/phone|salary|iban|employee_id/i);

  await setNumber(null);
  const hidden = await readBoard();
  expect(onBoard(hidden.in_now).map((row) => row.employee_number)).toEqual([null]);
  expect(onBoard(hidden.sessions).map((row) => row.employee_number)).toEqual([null]);
  const emptyBranch = await readReport(reportFx.branch);
  const emptyAll = await readReport('all');
  expect(emptyBranch.rows).toMatchObject([{ employee_id: reportFx.employee.id, employee_number: null }]);
  expect(emptyAll.rows).toMatchObject([{ employee_id: reportFx.employee.id, employee_number: null }]);
  const emptyCsv = await readCsv();
  expect(cell(emptyCsv, 0)).toBe('"رقم الموظف"');
  expect(cell(emptyCsv, 1)).toBe('"\u2014"');
  const bodies = JSON.stringify([shown, branch, all, hidden, emptyBranch, emptyAll]) + csv + emptyCsv;
  expect(bodies).not.toMatch(/phone|salary|iban/i);
  expect(emptyCsv).not.toMatch(/phone|salary|iban|employee_id/i);
});
