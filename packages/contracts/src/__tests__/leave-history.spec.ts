import { expect, it } from 'vitest';
import { z } from 'zod';
import {
  leaveHistoryCursorData,
  leaveHistoryItem,
  leaveHistoryQuery,
  leaveHistoryReportQuery,
  leaveHistoryReportSkipsDays,
} from '../staff/leave-history.js';
import { buildOpenApiDocument } from '../openapi.js';
const base = { from: '2026-01-01', to: '2026-12-31' };
it('validates required dates, inclusive 366 days, strict keys and AND filter values', () => {
  expect(leaveHistoryQuery.parse(base).limit).toBe(50);
  expect(leaveHistoryQuery.safeParse({ from: '2024-01-01', to: '2024-12-31' }).success).toBe(true);
  for (const q of [
    { from: '2026-12-31', to: '2026-01-01' },
    { ...base, to: '2027-01-02' },
    { ...base, 'types[]': ['BAD'] },
    { ...base, 'statuses[]': ['BAD'] },
    { ...base, employee_id: 'bad' },
  ])
    expect(leaveHistoryQuery.safeParse(q).success).toBe(false);
  expect(leaveHistoryQuery.parse({ ...base, 'statuses[]': ['ABSENT'] })['statuses[]']).toEqual([
    'ABSENT',
  ]);
});
it('requires identity on every variant and discriminates neutral context without status', () => {
  const id = '019a0000-0000-7000-8000-000000000001';
  const identity = {
    employee_id: id,
    employee_name_en: 'Synthetic',
    employee_name_ar: null,
    employee_number: 1,
  };
  const row = {
    ...identity,
    id,
    row_type: 'COVERED_ELSEWHERE',
    branch_id: id,
    working_date: '2026-01-01',
    shift: { start: '09:00', end: '17:00' },
  };
  expect(leaveHistoryItem.safeParse(row).success).toBe(true);
  expect(leaveHistoryItem.safeParse({ ...row, row_type: 'UNKNOWN' }).success).toBe(false);
  expect(leaveHistoryItem.safeParse({ ...row, employee_number: undefined }).success).toBe(false);
});
it('derives every OpenAPI query property from the runtime contract', () => {
  const paths = buildOpenApiDocument()['paths'] as Record<
    string,
    {
      get: { parameters: { in: string; name: string; schema: unknown }[] };
    }
  >;
  const parameters =
    paths['/v1/businesses/{businessId}/employees/{employeeId}/leave-history']?.get.parameters;
  const schema = z.toJSONSchema(leaveHistoryQuery, {
    target: 'openapi-3.0',
    io: 'input',
    metadata: z.registry(),
  });
  expect(
    Object.fromEntries(
      parameters?.filter((p) => p.in === 'query').map((p) => [p.name, p.schema]) ?? [],
    ),
  ).toEqual(schema.properties);
});
it('a year-zero period is refused before SQL, while year 0001 stays valid', () => {
  expect(leaveHistoryQuery.safeParse({ from: '0000-01-01', to: '0000-01-02' }).success).toBe(false);
  expect(leaveHistoryQuery.safeParse({ from: '0001-01-01', to: '0001-01-02' }).success).toBe(true);
});
it('a cursor with a year-zero date or as_of is refused, a legal one parses', () => {
  const cursor = {
    date: '2026-10-05',
    rank: 1,
    id: '019a0000-0000-7000-8000-000000000001',
    as_of: '2026-11-07T10:00:00.000Z',
  };
  expect(leaveHistoryCursorData.safeParse(cursor).success).toBe(true);
  expect(leaveHistoryCursorData.safeParse({ ...cursor, date: '0000-10-05' }).success).toBe(false);
  expect(
    leaveHistoryCursorData.safeParse({ ...cursor, as_of: '0000-11-07T10:00:00.000Z' }).success,
  ).toBe(false);
});
it('leaveHistoryReportQuery accepts employee_id and tab fields, rejects invalid values and overflow', () => {
  const employeeId = '019a0000-0000-7000-8000-000000000001';
  const report = leaveHistoryReportQuery.parse({ ...base, employee_id: employeeId });
  expect(report.employee_id).toBe(employeeId);
  expect(report.limit).toBe(50);
  expect(leaveHistoryReportQuery.safeParse({ ...base, employee_id: 'bad' }).success).toBe(false);
  expect(leaveHistoryReportQuery.safeParse({ ...base, unexpected_key: true }).success).toBe(false);
  const overflow = leaveHistoryReportQuery.safeParse({ ...base, to: '2027-01-02' });
  expect(overflow.success).toBe(false);
  if (!overflow.success) {
    expect(overflow.error.issues).toContainEqual(
      expect.objectContaining({ path: ['to'], message: 'LEAVE_HISTORY_RANGE_INVALID' }),
    );
  }
  expect(leaveHistoryQuery.safeParse({ ...base, employee_id: employeeId }).success).toBe(false);
});
it('OpenAPI specifies getLeaveHistoryReport with path businessId only and optional employee_id query', () => {
  const paths = buildOpenApiDocument()['paths'] as Record<
    string,
    {
      get: {
        operationId: string;
        parameters: { in: string; name: string; required: boolean }[];
      };
    }
  >;
  const reportOp = paths['/v1/businesses/{businessId}/leave-history']?.get;
  expect(reportOp?.operationId).toBe('getLeaveHistoryReport');
  const pathParams = reportOp?.parameters.filter((p) => p.in === 'path').map((p) => p.name);
  expect(pathParams).toEqual(['businessId']);
  const employeeQuery = reportOp?.parameters.find(
    (p) => p.in === 'query' && p.name === 'employee_id',
  );
  expect(employeeQuery).toBeDefined();
  expect(employeeQuery?.required).toBe(false);

  const employeeOp = paths['/v1/businesses/{businessId}/employees/{employeeId}/leave-history']?.get;
  expect(employeeOp?.operationId).toBe('getEmployeeLeaveHistory');
  expect(employeeOp?.parameters.some((p) => p.in === 'query' && p.name === 'employee_id')).toBe(
    false,
  );
});

it.each([
  { types: ['ANNUAL'], statuses: [], expected: true },
  { types: ['ANNUAL', 'SICK'], statuses: [], expected: true },
  { types: [], statuses: ['PENDING'], expected: true },
  { types: [], statuses: ['APPROVED', 'REJECTED'], expected: true },
  { types: [], statuses: [], expected: false },
  { types: ['UNEXCUSED_ABSENCE'], statuses: [], expected: false },
  { types: ['ANNUAL', 'UNEXCUSED_ABSENCE'], statuses: [], expected: false },
  { types: [], statuses: ['ABSENT'], expected: false },
  { types: [], statuses: ['PENDING', 'ABSENT'], expected: false },
  { types: ['UNEXCUSED_ABSENCE'], statuses: ['PENDING'], expected: true },
] as const)(
  'leaveHistoryReportSkipsDays returns $expected for types=$types statuses=$statuses',
  ({ types, statuses, expected }) => {
    const parsed = leaveHistoryReportQuery.parse({
      from: '2026-01-01',
      to: '2026-01-02',
      ...(types.length ? { 'types[]': [...types] } : {}),
      ...(statuses.length ? { 'statuses[]': [...statuses] } : {}),
    });
    expect(leaveHistoryReportSkipsDays(parsed)).toBe(expected);
    expect(
      leaveHistoryReportSkipsDays({
        'types[]': [...types],
        'statuses[]': [...statuses],
      }),
    ).toBe(expected);
  },
);
