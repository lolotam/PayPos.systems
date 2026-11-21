import { expect, it } from 'vitest';
import {
  collectFinderResults,
  groupIsCurrent,
  matchesPageQuery,
  visiblePages,
} from '../navigation-presentation.js';
import { groups, workspaces } from './navigation-fixtures.js';

it('filters pages without mutating the supplied navigation data', () => {
  const firstGroup = groups[0];
  if (!firstGroup) throw new Error('Navigation fixture missing first group');
  const pages = firstGroup.pages;
  expect(visiblePages(pages).map((page) => page.id)).toEqual(['approvals']);
  expect(visiblePages(pages, ['missing'])).toEqual([]);
  expect(visiblePages(pages, ['approvals', 'missing']).map((page) => page.id)).toEqual([
    'approvals',
  ]);
  expect(pages).toHaveLength(1);
});

it('matches a group by id or by one of its pages', () => {
  const group = groups[0];
  if (!group) throw new Error('Navigation fixture missing first group');
  expect(groupIsCurrent(group, 'home')).toBe(true);
  expect(groupIsCurrent(group, undefined, 'approvals')).toBe(true);
  expect(groupIsCurrent(group, 'sales', 'approvals')).toBe(true);
  expect(groupIsCurrent(group, 'sales', 'orders')).toBe(false);
});

it('matches translated labels case-insensitively after trimming', () => {
  expect(matchesPageQuery('Sales orders', '  ORDERS ')).toBe(true);
  expect(matchesPageQuery('الأعمدة', 'أعمدة')).toBe(true);
  expect(matchesPageQuery('Products', 'missing')).toBe(false);
});

it('collects finder results across workspaces and respects visibility', () => {
  const all = collectFinderResults(workspaces, undefined, '');
  expect(all).toHaveLength(6);
  expect(all[0]?.workspace.id).toBe('front-desk');
  const filtered = collectFinderResults(workspaces, ['columns', 'products'], '');
  expect(filtered.map((result) => result.page.id)).toEqual(['products', 'columns']);
  expect(collectFinderResults(workspaces, undefined, 'الأعمدة')).toHaveLength(1);
});
