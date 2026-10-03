import { expect, it } from 'vitest';
import {
  planEmployeeUpdate,
  type EditableEmployee,
  type EmployeeUpdateTerms,
} from '../update-employee.ts';

const before: EditableEmployee = {
  id: 'employee',
  business_id: 'business',
  primary_branch_id: 'A',
  name_en: 'Synthetic',
  name_ar: null,
  role_code: 'staff',
  hire_date: '2026-01-01',
  contract_end: null,
  user_id: null,
  created_at: '2026-10-03T00:00:00Z',
  revision: 1,
  branch_ids: ['A'],
};
const active = [{ id: 'attachment-A', branchId: 'A', from: '2026-01-01' }];
const terms: EmployeeUpdateTerms = {
  ...before,
  branch_ids: ['A'],
  expected_revision: 1,
  branch_effective_date: '2026-10-03',
};
const contexts = [{ businessExists: true, branchBusinessId: 'business' }];
it('unchanged fields and reordered branches preserve revision without a write', () => {
  expect(planEmployeeUpdate(before, terms, active, contexts)).toMatchObject({
    changed: false,
    after: before,
    attach: [],
    detach: [],
  });
  const b = { ...before, branch_ids: ['B', 'A'] };
  expect(
    planEmployeeUpdate(
      b,
      { ...terms, branch_ids: ['A', 'B'] },
      [...active, { id: 'attachment-B', branchId: 'B', from: '2026-02-01' }],
      contexts,
    ).changed,
  ).toBe(false);
});
it('changes fields with exactly one revision and keeps input immutable', () => {
  const plan = planEmployeeUpdate(
    before,
    {
      ...terms,
      name_ar: 'موظف تجريبي',
      role_code: 'cashier',
      hire_date: '2999-01-01',
      user_id: 'user',
      contract_end: '2999-01-01',
    },
    active,
    contexts,
  );
  expect(plan.after).toMatchObject({
    revision: 2,
    name_ar: 'موظف تجريبي',
    role_code: 'cashier',
    hire_date: '2999-01-01',
    user_id: 'user',
  });
  expect(before.revision).toBe(1);
  expect(active[0]?.from).toBe('2026-01-01');
});
it('plans attach and detach without rewriting the original attachment', () => {
  expect(
    planEmployeeUpdate(
      before,
      { ...terms, primary_branch_id: 'B', branch_ids: ['B'] },
      active,
      contexts,
    ),
  ).toMatchObject({
    attach: ['B'],
    detach: ['attachment-A'],
    after: { primary_branch_id: 'B', branch_ids: ['B'], revision: 2 },
  });
  expect(
    planEmployeeUpdate(before, { ...terms, branch_ids: ['B', 'A'] }, active, contexts).attach,
  ).toEqual(['B']);
});
it.each([
  [{ expected_revision: 2 }, 'EMPLOYEE_REVISION_CONFLICT'],
  [{ branch_ids: [] }, 'EMPLOYEE_PRIMARY_BRANCH_REQUIRED'],
  [{ primary_branch_id: 'B' }, 'EMPLOYEE_PRIMARY_BRANCH_REQUIRED'],
  [{ contract_end: '2025-01-01' }, 'EMPLOYEE_CONTRACT_END_BEFORE_HIRE'],
  [
    { primary_branch_id: 'B', branch_ids: ['B'], branch_effective_date: '2025-12-31' },
    'EMPLOYEE_BRANCH_DATE_BEFORE_START',
  ],
] as const)('refuses %j with named error %s', (change, code) => {
  expect(() => planEmployeeUpdate(before, { ...terms, ...change }, active, contexts)).toThrow(code);
});
it.each([
  [{ businessExists: false, branchBusinessId: null }, 'EMPLOYEE_BUSINESS_NOT_FOUND'],
  [{ businessExists: true, branchBusinessId: null }, 'EMPLOYEE_BRANCH_NOT_FOUND'],
  [{ businessExists: true, branchBusinessId: 'foreign' }, 'EMPLOYEE_BRANCH_BUSINESS_MISMATCH'],
] as const)('reuses create scope refusals %j', (context, code) => {
  expect(() => planEmployeeUpdate(before, terms, active, [context])).toThrow(code);
});
it('allows a same-day close and a primary-only change within already active branches', () => {
  expect(
    planEmployeeUpdate(
      before,
      { ...terms, primary_branch_id: 'B', branch_ids: ['B'], branch_effective_date: '2026-01-01' },
      active,
      contexts,
    ).detach,
  ).toEqual(['attachment-A']);
  const b = { ...before, branch_ids: ['A', 'B'] };
  const plan = planEmployeeUpdate(
    b,
    { ...terms, primary_branch_id: 'B', branch_ids: ['A', 'B'] },
    [...active, { id: 'attachment-B', branchId: 'B', from: '2026-01-01' }],
    contexts,
  );
  expect(plan).toMatchObject({ changed: true, attach: [], detach: [] });
});
