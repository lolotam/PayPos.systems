import { describe, expect, it } from 'vitest';

import {
  isServiceCategoryInUse,
  planServiceCategoryBranchState,
  serviceCategoryBranchSettingSnapshot,
  serviceCategoryBranchView,
  type ServiceCategoryBranchSettingRecord,
} from '../service-category-branch.ts';
import type { ServiceCategoryRecord } from '../service-category.ts';

const branch = '01920000-0000-7000-8000-000000000005';
const otherBranch = '01920000-0000-7000-8000-000000000006';
const at = new Date('2026-10-29T10:00:00.000Z');

function category(overrides: Partial<ServiceCategoryRecord> = {}): ServiceCategoryRecord {
  return {
    id: '01920000-0000-7000-8000-000000000001',
    business_id: '01920000-0000-7000-8000-000000000002',
    name_en: 'Hair Care',
    name_ar: 'صبغة',
    owner_branch_id: null,
    visibility: 'BUSINESS',
    closed_at: null,
    revision: 3,
    created_at: '2026-10-29T09:00:00.000Z',
    updated_at: '2026-10-29T09:00:00.000Z',
    ...overrides,
  };
}

function setting(overrides: Partial<ServiceCategoryBranchSettingRecord> = {}) {
  return {
    id: '01920000-0000-7000-8000-000000000007',
    business_id: category().business_id,
    branch_id: branch,
    category_id: category().id,
    state: 'ENABLED' as const,
    revision: 4,
    created_at: '2026-10-29T09:30:00.000Z',
    updated_at: '2026-10-29T09:30:00.000Z',
    ...overrides,
  };
}

function input(expected_revision: number | null, state: 'ENABLED' | 'HIDDEN' = 'ENABLED') {
  return {
    id: setting().id,
    business_id: category().business_id,
    branch_id: branch,
    category_id: category().id,
    state,
    category_closed: false,
    expected_revision,
  };
}

describe('a category in use in a branch', () => {
  it('uses an open shared category without a setting row', () => {
    expect(isServiceCategoryInUse(category(), branch, null)).toBe(true);
  });

  it('uses an own private category without a setting row', () => {
    const own = category({ visibility: 'BRANCH', owner_branch_id: branch });
    expect(isServiceCategoryInUse(own, branch, null)).toBe(true);
  });

  it('does not use another branch private category until it is enabled', () => {
    const other = category({ visibility: 'BRANCH', owner_branch_id: otherBranch });
    expect(isServiceCategoryInUse(other, branch, null)).toBe(false);
    expect(isServiceCategoryInUse(other, branch, 'ENABLED')).toBe(true);
  });

  it.each(['BUSINESS', 'BRANCH'] as const)('lets HIDDEN win over ownership for %s', (visibility) => {
    const own = category({ visibility, owner_branch_id: branch });
    expect(isServiceCategoryInUse(own, branch, 'HIDDEN')).toBe(false);
  });

  it('never uses a closed category, even when shared or enabled', () => {
    const closed = category({ closed_at: '2026-10-29T08:00:00.000Z' });
    expect(isServiceCategoryInUse(closed, branch, null)).toBe(false);
    expect(isServiceCategoryInUse(closed, branch, 'ENABLED')).toBe(false);
  });
});

describe('the branch setting revision and next state', () => {
  it('creates revision 1 on a first write with a null expectation', () => {
    expect(planServiceCategoryBranchState(null, input(null), at)).toEqual({
      ...setting({ revision: 1, created_at: at.toISOString(), updated_at: at.toISOString() }),
    });
  });

  it('refuses to enable a closed category before checking a stale revision', () => {
    expect(() =>
      planServiceCategoryBranchState(
        setting(),
        { ...input(3), category_closed: true },
        at,
      ),
    ).toThrow('SERVICE_CATEGORY_CLOSED');
  });

  it('allows hiding a closed category on a first write', () => {
    expect(
      planServiceCategoryBranchState(
        null,
        { ...input(null, 'HIDDEN'), category_closed: true },
        at,
      ),
    ).toEqual({
      ...setting({
        state: 'HIDDEN',
        revision: 1,
        created_at: at.toISOString(),
        updated_at: at.toISOString(),
      }),
    });
  });

  it.each([1, 4])('refuses a non-null expectation %i on a first write', (expected) => {
    expect(() => planServiceCategoryBranchState(null, input(expected), at)).toThrow(
      'SERVICE_CATEGORY_REVISION_CONFLICT',
    );
  });

  it('advances the revision and preserves created_at on a matching later write', () => {
    expect(planServiceCategoryBranchState(setting(), input(4, 'HIDDEN'), at)).toMatchObject({
      state: 'HIDDEN',
      revision: 5,
      created_at: setting().created_at,
      updated_at: at.toISOString(),
    });
  });

  it.each([null, 3, 5])('refuses stale expectation %s on a later write', (expected) => {
    expect(() => planServiceCategoryBranchState(setting(), input(expected), at)).toThrow(
      'SERVICE_CATEGORY_REVISION_CONFLICT',
    );
  });
});

describe('the branch projections', () => {
  it('keeps both setting fields null when no row exists', () => {
    expect(serviceCategoryBranchView(category(), null)).toMatchObject({
      id: category().id,
      revision: 3,
      setting_state: null,
      setting_revision: null,
    });
  });

  it('keeps category and setting revisions independent', () => {
    expect(serviceCategoryBranchView(category(), setting())).toMatchObject({
      revision: 3,
      setting_state: 'ENABLED',
      setting_revision: 4,
    });
  });

  it('snapshots the whole setting for the audit', () => {
    expect(serviceCategoryBranchSettingSnapshot(setting())).toEqual(setting());
  });
});
