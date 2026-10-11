import { expect, it } from 'vitest';
import { employeeDefaultShifts, setEmployeeDefaultShiftsInput } from '../staff/employee-default-shifts.js';
import { buildOpenApiDocument } from '../index.js';

it('accepts clear and an optional break, refuses extra fields and more than seven entries', () => {
  expect(setEmployeeDefaultShiftsInput.parse({ shifts: [] })).toEqual({ shifts: [] });
  const shift = { day: 0, start: '09:00', end: '17:00', break_start: '13:00', break_end: '14:00' };
  expect(setEmployeeDefaultShiftsInput.parse({ shifts: [shift] }).shifts).toEqual([shift]);
  expect(setEmployeeDefaultShiftsInput.safeParse({ shifts: [], reason: 'extra' }).success).toBe(false);
  expect(setEmployeeDefaultShiftsInput.safeParse({ shifts: Array(8).fill(shift) }).success).toBe(false);
});
it('registers profile and branch endpoints with their inline schemas', () => {
  const document = buildOpenApiDocument();
  const paths = document['paths'] as Record<string, unknown>;
  expect(paths['/v1/businesses/{businessId}/employees/{employeeId}/default-shifts']).toMatchObject({
    get: { responses: { '200': { content: { 'application/json': { schema: { properties: { branches: { type: 'array' } } } } } } } },
  });
  expect(paths['/v1/businesses/{businessId}/employees/{employeeId}/branches/{branchId}/default-shifts']).toMatchObject({
    put: { requestBody: { content: { 'application/json': { schema: { properties: { shifts: { maxItems: 7 } } } } } } },
  });
  expect(employeeDefaultShifts.safeParse({ employee_id: 'bad', can_manage: true, branches: [] }).success).toBe(false);
});
