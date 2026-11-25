import { describe, expect, it } from 'vitest';

import {
  employeesVisibleToBranches,
  planStatementExportScope,
  statementExportFilename,
  statementExportStillCovered,
  type FrozenEmployeeBranches,
} from '../statement-export-scope.ts';

const SALMIYA = 'b1';
const HAWALLI = 'b2';
const FARWANIYA = 'b3';

const employees: readonly FrozenEmployeeBranches[] = [
  { employeeId: 'sara', attachedBranchIds: [SALMIYA, HAWALLI] },
  { employeeId: 'rana', attachedBranchIds: [HAWALLI] },
  { employeeId: 'nora', attachedBranchIds: [FARWANIYA] },
  { employeeId: 'unattached', attachedBranchIds: [] },
];

describe('employeesVisibleToBranches', () => {
  it('keeps an employee when any frozen branch of hers is in the set, sorted and without duplicates', () => {
    expect(employeesVisibleToBranches(employees, [HAWALLI])).toEqual(['rana', 'sara']);
    expect(employeesVisibleToBranches(employees, [SALMIYA, HAWALLI])).toEqual(['rana', 'sara']);
  });

  it('never shows an employee with an empty frozen branch set to a branch reader', () => {
    expect(employeesVisibleToBranches(employees, [SALMIYA, HAWALLI, FARWANIYA])).not.toContain(
      'unattached',
    );
  });
});

describe('planStatementExportScope', () => {
  it('is BUSINESS only for a business-wide reader, with no arrays', () => {
    expect(
      planStatementExportScope({ businessWide: true, branchIds: [SALMIYA] }, employees),
    ).toEqual({
      kind: 'BUSINESS',
    });
  });

  it('stores the whole effective set, never one id, and the overlapping frozen employees (CM-55d, CM-23d)', () => {
    expect(
      planStatementExportScope({ businessWide: false, branchIds: [HAWALLI, SALMIYA] }, employees),
    ).toEqual({ kind: 'BRANCHES', branchIds: [SALMIYA, HAWALLI], employeeIds: ['rana', 'sara'] });
  });

  it('stays BRANCHES when the set covers every branch of the business (CM-23g) and may hold no employee', () => {
    expect(
      planStatementExportScope(
        { businessWide: false, branchIds: [SALMIYA, HAWALLI, FARWANIYA] },
        [],
      ),
    ).toEqual({ kind: 'BRANCHES', branchIds: [SALMIYA, HAWALLI, FARWANIYA], employeeIds: [] });
  });
});

describe('statementExportStillCovered', () => {
  const saved = planStatementExportScope({ businessWide: false, branchIds: [SALMIYA] }, employees);

  it.each([
    ['the same set', { businessWide: false, branchIds: [SALMIYA] }, true],
    ['a wider set', { businessWide: false, branchIds: [SALMIYA, HAWALLI] }, true],
    ['now business-wide', { businessWide: true, branchIds: [SALMIYA] }, true],
    ['a transfer to another branch (CM-55e)', { businessWide: false, branchIds: [HAWALLI] }, false],
    ['a DENY that removes the branch', { businessWide: false, branchIds: [FARWANIYA] }, false],
    ['an empty set', { businessWide: false, branchIds: [] }, false],
  ])('a BRANCHES request is still covered after %s: %s', (_name, current, covered) => {
    expect(statementExportStillCovered(saved, current, employees)).toBe(covered);
  });

  it('is not covered when a saved employee is no longer visible to the current set', () => {
    const wide = planStatementExportScope(
      { businessWide: false, branchIds: [SALMIYA, HAWALLI] },
      employees,
    );
    expect(
      statementExportStillCovered(wide, { businessWide: false, branchIds: [SALMIYA, HAWALLI] }, [
        { employeeId: 'sara', attachedBranchIds: [FARWANIYA] },
        { employeeId: 'rana', attachedBranchIds: [HAWALLI] },
      ]),
    ).toBe(false);
  });

  it('a BUSINESS request needs a business-wide reader again; a branch set is never enough', () => {
    const business = planStatementExportScope({ businessWide: true, branchIds: [] }, employees);
    expect(
      statementExportStillCovered(business, { businessWide: true, branchIds: [] }, employees),
    ).toBe(true);
    expect(
      statementExportStillCovered(
        business,
        { businessWide: false, branchIds: [SALMIYA, HAWALLI, FARWANIYA] },
        employees,
      ),
    ).toBe(false);
  });
});

describe('statementExportFilename', () => {
  it('is ASCII and carries the period', () => {
    expect(statementExportFilename('2026-10')).toBe('commission-statement-2026-10.xlsx');
  });
});
