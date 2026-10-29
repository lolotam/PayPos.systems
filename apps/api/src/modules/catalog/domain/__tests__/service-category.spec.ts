import { describe, expect, it } from 'vitest';

import {
  newBranchServiceCategory,
  newBusinessServiceCategory,
  normalizeServiceCategoryName,
  planServiceCategoryRename,
  serviceCategoryKey,
  serviceCategorySnapshot,
  serviceCategoryView,
  validateServiceCategoryNames,
  type ServiceCategoryRecord,
} from '../service-category.ts';

const at = new Date('2026-10-29T10:00:00Z');
// محرف تحكم صغير: الاسم به لا يصلح، والاسم العربي به كذلك.
const control = String.fromCharCode(1);

function record(overrides: Partial<ServiceCategoryRecord> = {}): ServiceCategoryRecord {
  return {
    id: '01920000-0000-7000-8000-000000000001',
    business_id: '01920000-0000-7000-8000-000000000002',
    name_en: 'Hair Care',
    name_ar: 'صبغة',
    owner_branch_id: null,
    visibility: 'BUSINESS',
    closed_at: null,
    revision: 1,
    created_at: '2026-10-29T09:00:00.000Z',
    updated_at: '2026-10-29T09:00:00.000Z',
    ...overrides,
  };
}

describe('the category names', () => {
  it.each([
    ['  Hair  Care  ', 'Hair Care'],
    ['Hair\tCare', 'Hair Care'],
    ['Hair\nCare', 'Hair Care'],
    ['Hair   ', 'Hair'],
    ['   ', ''],
  ])('normalizes %j to %j', (input, expected) => {
    expect(normalizeServiceCategoryName(input)).toBe(expected);
  });

  it.each([1, 100])('accepts a name of %i characters', (length) => {
    expect(() =>
      validateServiceCategoryNames({ name_en: 'a'.repeat(length), name_ar: 'ب' }),
    ).not.toThrow();
  });

  it.each([
    ['an empty English name', { name_en: '   ', name_ar: 'صبغة' }],
    ['an empty Arabic name', { name_en: 'Hair Care', name_ar: '  ' }],
    ['a 101-character name', { name_en: 'a'.repeat(101), name_ar: 'صبغة' }],
    ['a control character', { name_en: `Ha${control}ir`, name_ar: 'صبغة' }],
    ['a control character in the Arabic name', { name_en: 'Hair Care', name_ar: `صبغة${control}` }],
  ])('refuses %s', (_label, names) => {
    expect(() => validateServiceCategoryNames(names)).toThrow('SERVICE_CATEGORY_NAME_INVALID');
  });

  it('returns the normalized pair', () => {
    expect(validateServiceCategoryNames({ name_en: ' Hair  Care ', name_ar: ' صبغة ' })).toEqual({
      name_en: 'Hair Care',
      name_ar: 'صبغة',
    });
  });
});

describe('the business-wide category key', () => {
  it.each([
    ['Hair Care', 'hair care'],
    ['  Hair   Care ', 'hair care'],
    ['HAIR CARE', 'hair care'],
    ['Hair\tCare', 'hair care'],
  ])('keys %j to %j', (input, expected) => {
    expect(serviceCategoryKey(input)).toBe(expected);
  });

  it('makes the trimmed, collapsed and case-folded names the same key', () => {
    expect(serviceCategoryKey(' Hair  Care ')).toBe(serviceCategoryKey('hair care'));
  });
});

describe('creating a category', () => {
  it('creates a business category with no owner branch and revision 1', () => {
    const created = newBusinessServiceCategory(
      { name_en: 'Hair Care', name_ar: 'صبغة' },
      '01920000-0000-7000-8000-000000000003',
      '01920000-0000-7000-8000-000000000002',
      at,
    );
    expect(created).toMatchObject({
      owner_branch_id: null,
      visibility: 'BUSINESS',
      revision: 1,
      closed_at: null,
      created_at: '2026-10-29T10:00:00.000Z',
    });
  });

  it.each(['BUSINESS', 'BRANCH'] as const)(
    'records the owner branch of a %s category',
    (visibility) => {
      const created = newBranchServiceCategory(
        { name_en: 'Hair Care', name_ar: 'صبغة' },
        '01920000-0000-7000-8000-000000000004',
        '01920000-0000-7000-8000-000000000002',
        '01920000-0000-7000-8000-000000000005',
        visibility,
        at,
      );
      expect(created).toMatchObject({
        owner_branch_id: '01920000-0000-7000-8000-000000000005',
        visibility,
        revision: 1,
      });
    },
  );
});

describe('renaming a category', () => {
  const names = { name_en: 'Nails', name_ar: 'أظافر' };

  it('refuses a stale revision', () => {
    expect(() =>
      planServiceCategoryRename(
        record({ revision: 2 }),
        { names, expected_revision: 1, scope: 'BUSINESS', branch_id: null },
        at,
      ),
    ).toThrow('SERVICE_CATEGORY_REVISION_CONFLICT');
  });

  it('advances the revision and the timestamp on a rename', () => {
    const plan = planServiceCategoryRename(
      record(),
      { names, expected_revision: 1, scope: 'BUSINESS', branch_id: null },
      at,
    );
    expect(plan.changed).toBe(true);
    expect(plan.after).toMatchObject({
      name_en: 'Nails',
      name_ar: 'أظافر',
      revision: 2,
      updated_at: '2026-10-29T10:00:00.000Z',
    });
  });

  it('reports no change when nothing differs', () => {
    const current = record();
    const plan = planServiceCategoryRename(
      current,
      {
        names: { name_en: current.name_en, name_ar: current.name_ar },
        expected_revision: 1,
        scope: 'BUSINESS',
        branch_id: null,
      },
      at,
    );
    expect(plan.changed).toBe(false);
    expect(plan.after).toBe(current);
  });

  it('shares a private category and advances the revision', () => {
    const plan = planServiceCategoryRename(
      record({ visibility: 'BRANCH', owner_branch_id: '01920000-0000-7000-8000-000000000005' }),
      { names, visibility: 'BUSINESS', expected_revision: 1, scope: 'BUSINESS', branch_id: null },
      at,
    );
    expect(plan.after).toMatchObject({ visibility: 'BUSINESS', revision: 2 });
  });

  it('never makes a shared category private again', () => {
    expect(() =>
      planServiceCategoryRename(
        record(),
        { names, visibility: 'BRANCH', expected_revision: 1, scope: 'BUSINESS', branch_id: null },
        at,
      ),
    ).toThrow('SERVICE_CATEGORY_VISIBILITY_FIXED');
  });

  it('lets a branch rename and share its own private category', () => {
    const plan = planServiceCategoryRename(
      record({ visibility: 'BRANCH', owner_branch_id: '01920000-0000-7000-8000-000000000005' }),
      {
        names,
        visibility: 'BUSINESS',
        expected_revision: 1,
        scope: 'BRANCH',
        branch_id: '01920000-0000-7000-8000-000000000005',
      },
      at,
    );
    expect(plan.after).toMatchObject({ visibility: 'BUSINESS', revision: 2 });
  });

  it('refuses a branch rename of a shared category', () => {
    expect(() =>
      planServiceCategoryRename(
        record({ owner_branch_id: '01920000-0000-7000-8000-000000000005' }),
        {
          names,
          expected_revision: 1,
          scope: 'BRANCH',
          branch_id: '01920000-0000-7000-8000-000000000005',
        },
        at,
      ),
    ).toThrow('SERVICE_CATEGORY_VISIBILITY_FIXED');
  });

  it('refuses a branch rename of another branch private category', () => {
    expect(() =>
      planServiceCategoryRename(
        record({ visibility: 'BRANCH', owner_branch_id: '01920000-0000-7000-8000-000000000006' }),
        {
          names,
          expected_revision: 1,
          scope: 'BRANCH',
          branch_id: '01920000-0000-7000-8000-000000000005',
        },
        at,
      ),
    ).toThrow('SERVICE_CATEGORY_NOT_FOUND');
  });

  it('refuses a branch that tries to make a shared category private', () => {
    expect(() =>
      planServiceCategoryRename(
        record({ visibility: 'BUSINESS', owner_branch_id: '01920000-0000-7000-8000-000000000005' }),
        {
          names,
          visibility: 'BRANCH',
          expected_revision: 1,
          scope: 'BRANCH',
          branch_id: '01920000-0000-7000-8000-000000000005',
        },
        at,
      ),
    ).toThrow('SERVICE_CATEGORY_VISIBILITY_FIXED');
  });

  it('renames a closed category without touching its closed state', () => {
    const plan = planServiceCategoryRename(
      record({ closed_at: '2026-10-29T08:00:00.000Z' }),
      { names, expected_revision: 1, scope: 'BUSINESS', branch_id: null },
      at,
    );
    expect(plan.after.closed_at).toBe('2026-10-29T08:00:00.000Z');
  });
});

describe('the projections', () => {
  it('projects only the fields the screen reads', () => {
    expect(serviceCategoryView(record())).toEqual({
      id: '01920000-0000-7000-8000-000000000001',
      name_en: 'Hair Care',
      name_ar: 'صبغة',
      visibility: 'BUSINESS',
      owner_branch_id: null,
      closed_at: null,
      revision: 1,
    });
  });

  it('snapshots the whole record for the audit', () => {
    expect(serviceCategorySnapshot(record())).toMatchObject({ id: record().id, revision: 1 });
  });
});
