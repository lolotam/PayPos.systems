import type { ServiceCategoryBranchListItem } from '@pospay/contracts';

export const companyId = '01920000-0000-7000-8000-000000000001';
export const businessId = '01920000-0000-7000-8000-000000000002';
export const userId = '01920000-0000-7000-8000-000000000003';
export const branchId = '01920000-0000-7000-8000-0000000000b1';
export const otherBranchId = '01920000-0000-7000-8000-0000000000b2';

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

export function envelope(status: number, code: string, messageEn: string) {
  return {
    error: { code, message_ar: messageEn, message_en: messageEn },
    response: { status },
  };
}

export function okPage(items: unknown[], nextCursor: string | null = null) {
  return { data: { items, next_cursor: nextCursor }, response: { status: 200 } };
}
