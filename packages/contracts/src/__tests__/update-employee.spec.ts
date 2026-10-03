import { expect, it } from 'vitest';
import {
  updateEmployeeInput,
  employeeListQuery,
  employeeDetailRecord,
  buildOpenApiDocument,
} from '../index.js';
const id = '01920000-0000-7000-8000-0000000000a2';
const terms = {
  primary_branch_id: id,
  name_en: ' Synthetic ',
  role_code: 'staff',
  hire_date: '2026-01-01',
  expected_revision: 1,
  branch_ids: [id],
  branch_effective_date: '2026-10-03',
};
it('validates the update token, branches and date without accepting client scope claims', () => {
  expect(updateEmployeeInput.parse(terms).name_en).toBe('Synthetic');
  expect(
    updateEmployeeInput.safeParse({ ...terms, user_id: null, name_ar: null, contract_end: null })
      .success,
  ).toBe(true);
});
it.each([
  { expected_revision: 0 },
  { expected_revision: 1.5 },
  { expected_revision: 2_147_483_647 },
  { branch_ids: [] },
  { branch_ids: [id, id] },
  { branch_ids: ['invalid'] },
  { branch_effective_date: '2026-02-30' },
  { revision: 1 },
  { company_id: id },
  { business_id: id },
  { salary: '100.000' },
])('rejects invalid or unsupported update fields %j', (change) => {
  expect(updateEmployeeInput.safeParse({ ...terms, ...change }).success).toBe(false);
});
it('bounds cursor pages and requires current branch metadata on edit details', () => {
  expect(employeeListQuery.parse({})).toEqual({ limit: 20 });
  expect(employeeListQuery.safeParse({ cursor: 'foreign-text' }).success).toBe(false);
  expect(employeeListQuery.safeParse({ limit: '101' }).success).toBe(false);
  expect(employeeDetailRecord.safeParse(terms).success).toBe(false);
});
it('publishes list/detail/update paths and named conflict HTTP status', () => {
  const paths = buildOpenApiDocument()['paths'] as Record<
    string,
    { get?: { responses: object }; patch?: { responses: object; description: string } }
  >;
  expect(paths['/v1/businesses/{businessId}/employees']?.get?.responses).toHaveProperty('200');
  expect(
    paths['/v1/businesses/{businessId}/employees/{employeeId}']?.patch?.responses,
  ).toHaveProperty('409');
  const patch = paths['/v1/businesses/{businessId}/employees/{employeeId}']?.patch;
  expect(patch?.description).toContain('EMPLOYEE_BRANCH_HISTORY_OVERLAP (409)');
  expect(patch?.description).toContain('EMPLOYEE_BRANCH_HISTORY_IMMUTABLE, 409');
  expect(patch?.description).toContain('Adjacent intervals are allowed');
});
