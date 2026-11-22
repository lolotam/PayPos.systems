// @vitest-environment node

import { t } from '@pospay/i18n';
import { expect, it } from 'vitest';

import { NAVIGATION_PAGES } from '../navigation-model';
import { buildApprovalKinds } from './approval-kinds';
import type { MenuContext } from './menu-context';

const ctx = (visibleIds: readonly string[]): MenuContext => ({
  translate: (key) => t('en', key),
  pathname: '/',
  visibleIds,
});

it('lists the three kinds of approval that exist, each with its own address', () => {
  const kinds = buildApprovalKinds(ctx(NAVIGATION_PAGES.map((entry) => entry.id)));
  expect(kinds.map((kind) => [kind.id, kind.href])).toEqual([
    ['attendance-requests', '/staff/attendance-requests'],
    ['attendance-exceptions', '/staff/attendance-exceptions'],
    ['leave-approvals', '/leave'],
  ]);
  expect(kinds[0]?.label).toBe(t('en', 'attendanceActions.requests'));
});

it('leaves out a kind whose page the user may not see', () => {
  const kinds = buildApprovalKinds(ctx(['leave-approvals', 'dashboard']));
  expect(kinds.map((kind) => kind.id)).toEqual(['leave-approvals']);
});

it('lists nothing when no approval page is visible', () => {
  expect(buildApprovalKinds(ctx(['dashboard']))).toEqual([]);
});
