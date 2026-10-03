import { describe, expect, it } from 'vitest';
import {
  EmployeeCreationError,
  validateEmployeeCreation,
  type EmployeeRecord,
} from '../create-employee.ts';

const record: EmployeeRecord = {
  id: 'employee',
  business_id: 'business',
  primary_branch_id: 'branch',
  name_en: 'Synthetic',
  name_ar: null,
  role_code: 'staff',
  hire_date: '2026-09-01',
  contract_end: null,
  user_id: null,
  created_at: '2026-10-03T00:00:00.000Z',
};
const context = {
  businessExists: true,
  branchBusinessId: 'business',
};
describe('create-employee owner decision 2026-10-03', () => {
  it('accepts a primary branch in the business and equality dates', () => {
    expect(() => validateEmployeeCreation(record, context)).not.toThrow();
    expect(() =>
      validateEmployeeCreation(
        { ...record, hire_date: '2999-10-03', contract_end: '2999-10-03' },
        context,
      ),
    ).not.toThrow();
  });
  it.each([
    [{ businessExists: false }, 'EMPLOYEE_BRANCH_NOT_FOUND'],
    [{ branchBusinessId: null }, 'EMPLOYEE_BRANCH_NOT_FOUND'],
    [{ branchBusinessId: 'other' }, 'EMPLOYEE_BRANCH_NOT_FOUND'],
  ] as const)('refuses boundary mismatch %j', (change, code) => {
    expect(() => validateEmployeeCreation(record, { ...context, ...change })).toThrow(
      new EmployeeCreationError(code),
    );
  });
  it('allows a future hire and refuses an earlier contract end by name', () => {
    expect(() =>
      validateEmployeeCreation({ ...record, hire_date: '2999-01-01' }, context),
    ).not.toThrow();
    expect(() =>
      validateEmployeeCreation({ ...record, contract_end: '2026-08-31' }, context),
    ).toThrow(new EmployeeCreationError('EMPLOYEE_CONTRACT_END_BEFORE_HIRE'));
  });
  it.each([null, 'other'])(
    'hides invalid branch %s before diagnosing contract dates',
    (branchBusinessId) => {
      expect(() =>
        validateEmployeeCreation(
          { ...record, contract_end: '2025-01-01' },
          { ...context, branchBusinessId },
        ),
      ).toThrow('EMPLOYEE_BRANCH_NOT_FOUND');
    },
  );
});
