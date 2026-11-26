import type {
  ServiceCategoryBranchListItem,
  WorkspaceBranch,
  WorkspaceBusiness,
} from '@pospay/contracts';

export const companyId = '01920000-0000-7000-8000-000000000001';
export const businessId = '01920000-0000-7000-8000-000000000002';
export const userId = '01920000-0000-7000-8000-000000000003';
export const branchId = '01920000-0000-7000-8000-0000000000b1';
const otherBranchId = '01920000-0000-7000-8000-0000000000b2';

export function branch(overrides: Partial<WorkspaceBranch> = {}): WorkspaceBranch {
  return {
    id: branchId,
    name_en: 'First branch',
    name_ar: 'First branch AR',
    effective_timezone: 'Asia/Kuwait',
    is_active: true,
    ...overrides,
  };
}

export function secondBranch(): WorkspaceBranch {
  return branch({ id: otherBranchId, name_en: 'Second branch', name_ar: 'Second branch AR' });
}

export function branchCategory(
  overrides: Partial<ServiceCategoryBranchListItem> = {},
): ServiceCategoryBranchListItem {
  return {
    id: '01920000-0000-7000-8000-0000000000c1',
    name_en: 'Hair',
    name_ar: 'Hair AR',
    visibility: 'BUSINESS',
    owner_branch_id: null,
    closed_at: null,
    revision: 1,
    setting_state: 'ENABLED',
    setting_revision: 1,
    ...overrides,
  };
}

export function business(
  branches: readonly WorkspaceBranch[],
  scope?: WorkspaceBusiness['scope'],
): WorkspaceBusiness {
  return {
    id: businessId,
    name_en: 'Business',
    name_ar: null,
    business_type: 'salon',
    country: null,
    branches: [...branches],
    ...(scope === undefined ? {} : { scope }),
  };
}
