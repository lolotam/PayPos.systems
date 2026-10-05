import { describe, expect, it } from 'vitest';
import { buildOpenApiDocument, createEmployeeInput, employeeRoleCode } from '../index.js';

const input = {
  primary_branch_id: '01920000-0000-7000-8000-0000000000a2',
  name_en: ' Example ',
  role_code: 'staff',
  hire_date: '2026-01-01',
};
describe('employee contract', () => {
  it('trims required names and permits absent or null optional fields', () => {
    expect(createEmployeeInput.parse(input)).toEqual({ ...input, name_en: 'Example' });
    expect(
      createEmployeeInput.safeParse({ ...input, name_ar: null, user_id: null, contract_end: null })
        .success,
    ).toBe(true);
  });
  it.each([
    { name_en: '' },
    { name_en: '  ' },
    { name_en: 'x'.repeat(256) },
    { name_ar: '' },
    { role_code: 'device' },
    { role_code: 'OWNER' },
    { primary_branch_id: 'wrong' },
    { hire_date: '2026-02-30' },
    { hire_date: '2026-13-01' },
    { hire_date: '2026-01-01T00:00:00Z' },
    { user_id: 'wrong' },
    { contract_end: 'invalid' },
    { company_id: input.primary_branch_id },
    { salary: '100.000' },
  ])('rejects malformed or extra fields %j', (change) => {
    expect(createEmployeeInput.safeParse({ ...input, ...change }).success).toBe(false);
  });
  it('publishes exactly thirteen final human roles', () => {
    expect(employeeRoleCode.options).toHaveLength(13);
    expect(employeeRoleCode.options).not.toContain('device');
  });
  it('accepts future hire dates and leaves contract ordering to the named domain refusal', () => {
    expect(createEmployeeInput.safeParse({ ...input, hire_date: '2999-01-01' }).success).toBe(true);
    expect(createEmployeeInput.safeParse({ ...input, contract_end: '2025-01-01' }).success).toBe(
      true,
    );
  });
  it('publishes real create status and separate staff detail path', () => {
    const paths = buildOpenApiDocument()['paths'] as Record<
      string,
      { post?: { responses: object }; get?: object }
    >;
    expect(paths['/v1/businesses/{businessId}/employees']?.post?.responses).toHaveProperty('201');
    expect(paths['/v1/businesses/{businessId}/employees/{employeeId}']?.get).toBeDefined();
  });
});
