import { expect, it } from 'vitest';
import { mergeAttendanceStatementRows } from '../attendance-statement-rows.js';

interface Row {
  employee_id: string;
  employee_number: number;
  sessions: string[];
}

const report: Row[] = [
  { employee_id: 'b', employee_number: 2, sessions: ['sara'] },
  { employee_id: 'a', employee_number: 1, sessions: ['reem'] },
];
const scheduled: Row[] = [
  { employee_id: 'a', employee_number: 1, sessions: [] },
  { employee_id: 'c', employee_number: 3, sessions: [] },
];

it('issue #561: an employee in both lists appears once with the report row', () => {
  const merged = mergeAttendanceStatementRows(report, scheduled);
  expect(merged).toHaveLength(3);
  expect(merged.filter((row) => row.employee_id === 'a')).toHaveLength(1);
  expect(merged.find((row) => row.employee_id === 'a')?.sessions).toEqual(['reem']);
});

it('a schedule-only employee is added to the report rows', () => {
  const merged = mergeAttendanceStatementRows(report, scheduled);
  expect(merged.find((row) => row.employee_id === 'c')).toEqual({
    employee_id: 'c', employee_number: 3, sessions: [],
  });
});

it('the merged rows are sorted by the employee number', () => {
  expect(mergeAttendanceStatementRows(report, scheduled).map((row) => row.employee_number)).toEqual([1, 2, 3]);
});

it('the inputs are never changed', () => {
  const before = JSON.stringify([report, scheduled]);
  mergeAttendanceStatementRows(report, scheduled);
  expect(JSON.stringify([report, scheduled])).toBe(before);
});
