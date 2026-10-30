import { expect, it } from 'vitest';

import {
  createBranchServiceCategoryInput,
  createServiceCategoryInput,
  renameServiceCategoryInput,
  serviceCategoryBranchListQuery,
  serviceCategoryBranchPage,
  serviceCategoryBranchStateResult,
  serviceCategoryListQuery,
  serviceCategoryPage,
  setServiceCategoryBranchStateInput,
} from './service-category.js';

const id = '01920000-0000-7000-8000-000000000001';

it('requires both names, trims their edges, and bounds them at 100 characters', () => {
  expect(
    createServiceCategoryInput.parse({ name_en: '  Hair  ', name_ar: '  صبغة  ' }),
  ).toEqual({ name_en: 'Hair', name_ar: 'صبغة' });
  for (const field of ['name_en', 'name_ar'] as const) {
    expect(
      createServiceCategoryInput.safeParse({
        name_en: 'Hair',
        name_ar: 'صبغة',
        [field]: ' ',
      }).success,
    ).toBe(false);
    expect(
      createServiceCategoryInput.safeParse({
        name_en: 'Hair',
        name_ar: 'صبغة',
        [field]: 'a'.repeat(101),
      }).success,
    ).toBe(false);
    expect(
      createServiceCategoryInput.safeParse({
        name_en: 'Hair',
        name_ar: 'صبغة',
        [field]: 'a'.repeat(100),
      }).success,
    ).toBe(true);
  }
});

it.each(['\tHair', 'Hair\n', 'Ha\u0001ir'])('refuses control characters in %j', (name) => {
  expect(createServiceCategoryInput.safeParse({ name_en: name, name_ar: 'صبغة' }).success).toBe(
    false,
  );
});

it('requires visibility only on branch create and expected_revision on rename', () => {
  expect(
    createBranchServiceCategoryInput.safeParse({ name_en: 'Hair', name_ar: 'صبغة' }).success,
  ).toBe(false);
  expect(
    createBranchServiceCategoryInput.parse({
      name_en: 'Hair',
      name_ar: 'صبغة',
      visibility: 'BRANCH',
    }).visibility,
  ).toBe('BRANCH');
  expect(
    renameServiceCategoryInput.safeParse({ name_en: 'Hair', name_ar: 'صبغة' }).success,
  ).toBe(false);
});

it('defaults the list to open, validates its cursor and limits, and parses its page', () => {
  expect(serviceCategoryListQuery.parse({})).toEqual({ status: 'open', limit: 20 });
  expect(serviceCategoryListQuery.safeParse({ status: 'unknown' }).success).toBe(false);
  expect(serviceCategoryListQuery.safeParse({ limit: 101 }).success).toBe(false);
  expect(serviceCategoryListQuery.safeParse({ cursor: 'not-json' }).success).toBe(false);
  expect(serviceCategoryListQuery.safeParse({ cursor: JSON.stringify(['\u0000', id]) }).success).toBe(false);
  const cursor = JSON.stringify(['hair', id]);
  expect(serviceCategoryListQuery.parse({ cursor, status: 'all' }).cursor).toBe(cursor);
  expect(
    serviceCategoryPage.parse({
      items: [
        {
          id,
          name_en: 'Hair',
          name_ar: 'صبغة',
          visibility: 'BRANCH',
          owner_branch_id: id,
          closed_at: null,
          revision: 1,
        },
      ],
      next_cursor: cursor,
    }).next_cursor,
  ).toBe(cursor);
});

it('validates the branch view and the nullable setting revision on state writes and responses', () => {
  expect(serviceCategoryBranchListQuery.parse({ view: 'available' })).toEqual({
    view: 'available',
    limit: 20,
  });
  expect(serviceCategoryBranchListQuery.safeParse({ view: 'closed' }).success).toBe(false);
  expect(setServiceCategoryBranchStateInput.parse({ state: 'HIDDEN', expected_revision: null })).toEqual({
    state: 'HIDDEN',
    expected_revision: null,
  });
  expect(
    setServiceCategoryBranchStateInput.safeParse({ state: 'ENABLED', expected_revision: 0 }).success,
  ).toBe(false);
  const item = {
    id,
    name_en: 'Hair',
    name_ar: 'صبغة',
    visibility: 'BRANCH',
    owner_branch_id: id,
    closed_at: null,
    revision: 2,
    setting_state: 'ENABLED',
    setting_revision: 1,
  };
  expect(serviceCategoryBranchStateResult.parse(item)).toEqual(item);
  expect(serviceCategoryBranchPage.parse({ items: [item], next_cursor: null }).items).toEqual([item]);
  expect(
    serviceCategoryBranchStateResult.parse({ ...item, setting_state: null, setting_revision: null }),
  ).toMatchObject({ setting_state: null, setting_revision: null });
});
