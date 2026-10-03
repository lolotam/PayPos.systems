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
const active = [{ id: 'attachment-A', branchId: 'A', from: '2026-01-01', to: null }];
const terms: EmployeeUpdateTerms = {
  ...before,
  branch_ids: ['A'],
  expected_revision: 1,
  branch_effective_date: '2026-10-03',
};
const contexts = [{ businessExists: true, branchBusinessId: 'business' }];
const moved = { ...before, primary_branch_id: 'B', branch_ids: ['B'], revision: 2 };
const history = [
  { id: 'attachment-A', branchId: 'A', from: '2026-01-01', to: '2026-10-15' },
  { id: 'attachment-B', branchId: 'B', from: '2026-10-15', to: null },
];
it.each(['2026-10-10', '2026-10-14'])(
  'refuses reattachment on %s overlapping closed history',
  (date) => {
    expect(() =>
      planEmployeeUpdate(
        moved,
        {
          ...terms,
          primary_branch_id: 'B',
          branch_ids: ['A', 'B'],
          expected_revision: 2,
          branch_effective_date: date,
        },
        history,
        contexts,
      ),
    ).toThrow('EMPLOYEE_BRANCH_HISTORY_OVERLAP');
  },
);
it('permits adjacent reattachment and scopes the check to the attached branch', () => {
  const plan = planEmployeeUpdate(
    moved,
    {
      ...terms,
      primary_branch_id: 'B',
      branch_ids: ['A', 'B'],
      expected_revision: 2,
      branch_effective_date: '2026-10-15',
    },
    history,
    contexts,
  );
  expect(plan).toMatchObject({ attach: ['A'], detach: [], after: { revision: 3 } });
  expect(history[0]?.to).toBe('2026-10-15');
});
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
      [...active, { id: 'attachment-B', branchId: 'B', from: '2026-02-01', to: null }],
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
  [{ businessExists: false, branchBusinessId: null }, 'EMPLOYEE_BRANCH_NOT_FOUND'],
  [{ businessExists: true, branchBusinessId: null }, 'EMPLOYEE_BRANCH_NOT_FOUND'],
  [{ businessExists: true, branchBusinessId: 'foreign' }, 'EMPLOYEE_BRANCH_NOT_FOUND'],
] as const)('reuses create scope refusals %j', (context, code) => {
  expect(() => planEmployeeUpdate(before, terms, active, [context])).toThrow(code);
});
it('rejects an empty interval and permits a primary-only change within active branches', () => {
  expect(() =>
    planEmployeeUpdate(
      before,
      { ...terms, primary_branch_id: 'B', branch_ids: ['B'], branch_effective_date: '2026-01-01' },
      active,
      contexts,
    ),
  ).toThrow('EMPLOYEE_BRANCH_DATE_BEFORE_START');
  const b = { ...before, branch_ids: ['A', 'B'] };
  const plan = planEmployeeUpdate(
    b,
    { ...terms, primary_branch_id: 'B', branch_ids: ['A', 'B'] },
    [...active, { id: 'attachment-B', branchId: 'B', from: '2026-01-01', to: null }],
    contexts,
  );
  expect(plan).toMatchObject({ changed: true, attach: [], detach: [] });
});
it.each([null, 'foreign'])(
  'hides invalid branch %s before other edit diagnostics',
  (branchBusinessId) => {
    expect(() =>
      planEmployeeUpdate(
        before,
        { ...terms, expected_revision: 2, primary_branch_id: 'absent', contract_end: '2025-01-01' },
        active,
        [{ businessExists: true, branchBusinessId }],
      ),
    ).toThrow('EMPLOYEE_BRANCH_NOT_FOUND');
  },
);
