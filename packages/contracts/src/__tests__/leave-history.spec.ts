import { expect, it } from 'vitest';
import { z } from 'zod';
import { leaveHistoryItem, leaveHistoryQuery } from '../staff/leave-history.js';
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
