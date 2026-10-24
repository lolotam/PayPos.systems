import { expect, it } from 'vitest';
import { salaryChanged } from './salary.js';

const employeeId = '01920000-0000-7000-8000-000000000001';
const businessId = '01920000-0000-7000-8000-000000000002';
const legacy = {
  employee_id: employeeId,
  effective_from: '2026-01-01',
  amount: '123.456',
  revision: 1,
};

it('accepts a legacy payload without business_id', () => {
  const parsed = salaryChanged.parse(legacy);
  expect(parsed.business_id).toBeUndefined();
});

it('accepts a new payload and preserves business_id', () => {
  const parsed = salaryChanged.parse({ ...legacy, business_id: businessId });
  expect(parsed.business_id).toBe(businessId);
});

it('rejects unknown keys', () => {
  expect(salaryChanged.safeParse({ ...legacy, company_id: employeeId }).success).toBe(false);
});

it('rejects an invalid business_id', () => {
  expect(salaryChanged.safeParse({ ...legacy, business_id: 'not-a-uuid' }).success).toBe(false);
});

it.each([0, 1.5])('rejects a zero or non-integer revision: %s', (revision) => {
  expect(salaryChanged.safeParse({ ...legacy, revision }).success).toBe(false);
});

it.each(['123', '123.4', '123.45', '123.4567'])(
  'rejects an amount that is not a 3-decimal string: %s',
  (amount) => {
    expect(salaryChanged.safeParse({ ...legacy, amount }).success).toBe(false);
  },
);
