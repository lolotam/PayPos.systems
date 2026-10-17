import { describe, expect, it } from 'vitest';

import { createdEmployee, employee, employeeDetailRecord } from '../index.js';

const body = {
  id: '01920000-0000-7000-8000-0000000000a2',
  business_id: '01920000-0000-7000-8000-0000000000a2',
  primary_branch_id: '01920000-0000-7000-8000-0000000000a2',
  name_en: 'Synthetic',
  name_ar: null,
  role_code: 'staff' as const,
  hire_date: '2026-01-01',
  contract_end: null,
  user_id: null,
  created_at: '2026-10-03T00:00:00.000Z',
};

describe('createdEmployee', () => {
  it('accepts a number or null and rejects a missing, zero or million value', () => {
    expect(createdEmployee.parse({ ...body, employee_number: 7 }).employee_number).toBe(7);
    expect(createdEmployee.parse({ ...body, employee_number: null }).employee_number).toBeNull();
    expect(createdEmployee.parse({ ...body, employee_number: 999_999 }).employee_number).toBe(
      999_999,
    );
    expect(createdEmployee.safeParse(body).success).toBe(false);
    expect(createdEmployee.safeParse({ ...body, employee_number: 0 }).success).toBe(false);
    expect(createdEmployee.safeParse({ ...body, employee_number: 1_000_000 }).success).toBe(false);
  });

  it('leaves employee and employeeDetailRecord without a required number', () => {
    expect(employee.safeParse(body).success).toBe(true);
    expect(employee.parse({ ...body, employee_number: 4 })).not.toHaveProperty('employee_number');
    expect(
      employeeDetailRecord.safeParse({ ...body, revision: 1, branch_ids: [body.id] }).success,
    ).toBe(true);
  });
});
