// @vitest-environment node

import { t } from '@pospay/i18n';
import { expect, it } from 'vitest';

import type { ApprovalKindAccess } from '@/staff/api/use-approval-kind-access';

import { NAVIGATION_PAGES } from '../navigation-model';
import { buildApprovalKinds } from './approval-kinds';
import type { MenuContext } from './menu-context';

const ctx = (visibleIds: readonly string[]): MenuContext => ({
  translate: (key) => t('en', key),
  pathname: '/',
  visibleIds,
});

const everything = NAVIGATION_PAGES.map((entry) => entry.id);
const allowed: ApprovalKindAccess = {
  'leave-approvals': true,
  'attendance-requests': true,
  'attendance-exceptions': true,
};

it('lists the three kinds of approval that exist, each with its own address', () => {
  const kinds = buildApprovalKinds(ctx(everything), allowed);
  expect(kinds.map((kind) => [kind.id, kind.href])).toEqual([
    ['attendance-requests', '/staff/attendance-requests'],
    ['attendance-exceptions', '/staff/attendance-exceptions'],
    ['leave-approvals', '/leave'],
  ]);
  expect(kinds[0]?.label).toBe(t('en', 'attendanceActions.requests'));
});

it('leaves out a kind whose page read is refused or still loading', () => {
  const kinds = buildApprovalKinds(ctx(everything), { ...allowed, 'attendance-exceptions': false });
  expect(kinds.map((kind) => kind.id)).toEqual(['attendance-requests', 'leave-approvals']);
});

it('leaves out a kind whose page is not visible in the menu', () => {
  expect(
    buildApprovalKinds(ctx(['leave-approvals', 'dashboard']), allowed).map((kind) => kind.id),
  ).toEqual(['leave-approvals']);
});

it('lists nothing when no approval page may be opened', () => {
  const none: ApprovalKindAccess = {
    'leave-approvals': false,
    'attendance-requests': false,
    'attendance-exceptions': false,
  };
  expect(buildApprovalKinds(ctx(everything), none)).toEqual([]);
});
