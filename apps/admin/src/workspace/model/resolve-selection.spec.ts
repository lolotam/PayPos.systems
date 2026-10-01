import type { WorkspaceBranch, WorkspaceBusiness, WorkspaceCompany } from '@pospay/contracts';
import { describe, expect, it } from 'vitest';

import { resolveSelection } from './resolve-selection';

function makeBranch(id: string): WorkspaceBranch {
  return {
    id,
    name_ar: id,
    name_en: id,
    effective_timezone: 'Asia/Kuwait',
    is_active: true,
  };
}

function makeBusiness(id: string, branches: WorkspaceBranch[]): WorkspaceBusiness {
  return { id, name_ar: id, name_en: id, branches };
}

function makeCompany(id: string, businesses: WorkspaceBusiness[]): WorkspaceCompany {
  return { id, name_ar: id, name_en: id, role_code: 'owner', scope: 'COMPANY', businesses };
}

const br11a = makeBranch('br-1-1-a');
const br11b = makeBranch('br-1-1-b');
const biz11 = makeBusiness('biz-1-1', [br11a, br11b]);

const br12a = makeBranch('br-1-2-a');
const br12b = makeBranch('br-1-2-b');
const biz12 = makeBusiness('biz-1-2', [br12a, br12b]);

const company1 = makeCompany('comp-1', [biz11, biz12]);

const br21a = makeBranch('br-2-1-a');
const br21b = makeBranch('br-2-1-b');
const biz21 = makeBusiness('biz-2-1', [br21a, br21b]);

const company2 = makeCompany('comp-2', [biz21]);

function checkNoCompanies(): void {
  expect(resolveSelection([], {})).toEqual({ status: 'empty' });
  expect(
    resolveSelection([], { companyId: 'comp-1', businessId: 'biz-1-1', branchId: 'br-1-1-a' }),
  ).toEqual({ status: 'empty' });
}

function checkAutoSelect(): void {
  const result = resolveSelection([company1], {});
  expect(result.status).toBe('ready');
  expect(result.company).toEqual(company1);
}

function checkKeepsSelection(): void {
  const result = resolveSelection([company1, company2], {
    companyId: 'comp-1',
    businessId: 'biz-1-1',
    branchId: 'br-1-1-a',
  });
  expect(result).toEqual({ status: 'ready', company: company1, business: biz11, branch: br11a });
}

function checkDropsMissing(): void {
  expect(
    resolveSelection([company1, company2], {
      companyId: 'comp-removed',
      businessId: 'biz-1-1',
      branchId: 'br-1-1-a',
    }),
  ).toEqual({ status: 'choose' });

  expect(
    resolveSelection([company1, company2], {
      companyId: 'comp-1',
      businessId: 'biz-removed',
      branchId: 'br-1-1-a',
    }),
  ).toEqual({ status: 'ready', company: company1, business: undefined, branch: undefined });

  expect(
    resolveSelection([company1, company2], {
      companyId: 'comp-1',
      businessId: 'biz-1-1',
      branchId: 'br-removed',
    }),
  ).toEqual({ status: 'ready', company: company1, business: biz11, branch: undefined });
}

function checkBranchOwnership(): void {
  const result = resolveSelection([company1, company2], {
    companyId: 'comp-1',
    businessId: 'biz-1-2',
    branchId: 'br-1-1-a',
  });
  expect(result).toEqual({ status: 'ready', company: company1, business: biz12, branch: undefined });
}

describe('resolveSelection', () => {
  it('returns empty selection when there are no companies', checkNoCompanies);
  it('auto-selects the company when there is only one', checkAutoSelect);
  it('keeps stored selection when it still exists in the workspace tree', checkKeepsSelection);
  it('drops stored company/business/branch when missing from workspace tree', checkDropsMissing);
  it('only keeps a branch under its own business', checkBranchOwnership);
});
