import type { ServiceCategoryBranchListItem } from '@pospay/contracts';
import { describe, expect, it } from 'vitest';
import { branchCategoryActions, branchCategoryMarks } from './service-category-branch';

const branchId = '01920000-0000-7000-8000-0000000000b1';
const otherBranchId = '01920000-0000-7000-8000-0000000000b2';

function branchItem(
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

describe('branchCategoryMarks', () => {
  it('marks a private category owned by this branch', () => {
    const item = branchItem({ visibility: 'BRANCH', owner_branch_id: branchId });
    expect(branchCategoryMarks(item, branchId)).toEqual({ ownedHere: true, hiddenHere: false });
  });

  it('marks a hidden category even when it is shared', () => {
    const item = branchItem({ setting_state: 'HIDDEN' });
    expect(branchCategoryMarks(item, branchId)).toEqual({ ownedHere: false, hiddenHere: true });
  });

  it('marks own private and hidden together', () => {
    const item = branchItem({
      visibility: 'BRANCH',
      owner_branch_id: branchId,
      setting_state: 'HIDDEN',
    });
    expect(branchCategoryMarks(item, branchId)).toEqual({ ownedHere: true, hiddenHere: true });
  });

  it('does not mark a shared category this branch created as its own', () => {
    const item = branchItem({ visibility: 'BUSINESS', owner_branch_id: branchId });
    expect(branchCategoryMarks(item, branchId)).toEqual({ ownedHere: false, hiddenHere: false });
  });

  it('marks nothing on an enabled shared category owned by another branch', () => {
    const item = branchItem({ owner_branch_id: otherBranchId });
    expect(branchCategoryMarks(item, branchId)).toEqual({ ownedHere: false, hiddenHere: false });
  });
});

describe('branchCategoryActions', () => {
  it.each([
    ['in_use', { hide: true, enable: false }],
    ['available', { hide: false, enable: true }],
  ] as const)('offers the state write of the %s view only', (view, stateActions) => {
    const item = branchItem();
    expect(branchCategoryActions(item, branchId, view)).toEqual({
      ...stateActions,
      rename: false,
      share: false,
    });
  });

  it('offers rename and share only for a private category owned by this branch', () => {
    const item = branchItem({ visibility: 'BRANCH', owner_branch_id: branchId });
    expect(branchCategoryActions(item, branchId, 'in_use')).toEqual({
      hide: true,
      enable: false,
      rename: true,
      share: true,
    });
    expect(branchCategoryActions(item, branchId, 'available')).toEqual({
      hide: false,
      enable: true,
      rename: true,
      share: true,
    });
  });

  it('offers no rename or share for a shared category even when this branch created it', () => {
    const item = branchItem({ visibility: 'BUSINESS', owner_branch_id: branchId });
    expect(branchCategoryActions(item, branchId, 'in_use').rename).toBe(false);
    expect(branchCategoryActions(item, branchId, 'in_use').share).toBe(false);
  });

  it('offers no rename or share for a private category owned by another branch', () => {
    const item = branchItem({ visibility: 'BRANCH', owner_branch_id: otherBranchId });
    expect(branchCategoryActions(item, branchId, 'available').rename).toBe(false);
    expect(branchCategoryActions(item, branchId, 'available').share).toBe(false);
  });
});
