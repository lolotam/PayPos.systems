import { t } from '@pospay/i18n';
import { screen, within } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';

import { frameState, renderFrame, resetFrameState, stubViewport } from './frame-test-support';
import { StyleCFrame } from './style-c-frame';

type Read = { isSuccess?: boolean; isPending?: boolean; isError?: boolean; data?: unknown };
const reads = vi.hoisted(() => ({
  userId: 'user-1' as string | null,
  identity: {} as Read,
  columns: {} as Read,
}));

vi.mock('next/navigation', async () => (await import('./frame-test-support')).navigationMock);
vi.mock(
  '@/shared/locale/locale-context',
  async () => (await import('./frame-test-support')).localeMock,
);
vi.mock(
  '@/workspace/model/workspace-provider',
  async () => (await import('./frame-test-support')).workspaceMock,
);
vi.mock('@/session/api/use-session', async () => ({
  ...(await import('./frame-test-support')).sessionMock,
  useSessionUser: () => reads.userId,
}));
vi.mock(
  '@/session/api/use-sign-out',
  async () => (await import('./frame-test-support')).signOutMock,
);
vi.mock(
  '@/notifications/ui/notification-bell',
  async () => (await import('./frame-test-support')).bellMock,
);
vi.mock(
  '@/shared/locale/locale-switch',
  async () => (await import('./frame-test-support')).localeSwitchMock,
);
vi.mock('@/business-identity/api/use-business-identity-access', () => ({
  useBusinessIdentityAccess: () => reads.identity,
}));
vi.mock('@/settings/staff-app-columns/api/use-staff-columns', () => ({
  useStaffColumns: () => reads.columns,
}));
vi.mock('@/settings/alert-rules/api/use-alert-rules', () => ({ useAlertRules: () => ({}) }));
vi.mock('@/settings/alert-rules/api/use-rating-settings', () => ({
  useRatingSettings: () => ({}),
}));
vi.mock('@/commissions/api/plan-access', () => ({
  planScope: () => [],
  usePlanAccess: () => ({ denied: false, generation: 0 }),
}));
vi.mock('@/commissions/api/use-commission-plan-employees', () => ({
  useCommissionPlanEmployees: () => ({}),
}));
vi.mock('@/staff/api/use-employee-app-link', () => ({ useEmployeeAppLink: () => ({}) }));
vi.mock('@/ratings/api/use-ratings-access', () => ({ useRatingsAccess: () => ({}) }));
vi.mock('@/settings/imported-refunds/api/use-imported-refunds', () => ({
  useImportedRefunds: () => ({}),
}));
vi.mock('@/staff/api/use-leave-report-access', () => ({
  useLeaveReportAccess: () => ({ allowed: false }),
}));
vi.mock('@/permissions/api/use-invitations-access', () => ({
  useInvitationsAccess: () => ({ isSuccess: true, isFetchedAfterMount: true }),
}));

const panel = () =>
  within(screen.getByRole('complementary', { name: t('en', 'adminNav.localNavigation') }));
const identityLink = () => panel().queryByRole('link', { name: /Business identity/ });

beforeEach(() => {
  resetFrameState();
  stubViewport(1280);
  frameState.pathname = '/permissions';
  reads.userId = 'user-1';
  reads.identity = { isPending: true };
  reads.columns = { isPending: true };
});

it('shows a guarded page only once its real access read says yes, using the real visibility hook', () => {
  const { rerenderFrame } = renderFrame(<StyleCFrame>Page body</StyleCFrame>);
  expect(panel().getByRole('link', { name: /Permissions/ })).toBeTruthy();
  expect(identityLink()).toBeNull();
  reads.identity = { isPending: false, isError: false, data: true };
  rerenderFrame(<StyleCFrame>Page body</StyleCFrame>);
  expect(identityLink()).toBeTruthy();
});

it('hides the guarded page again when a later read fails although the old answer was yes', () => {
  reads.identity = { isPending: false, isError: false, data: true };
  const { rerenderFrame } = renderFrame(<StyleCFrame>Page body</StyleCFrame>);
  expect(identityLink()).toBeTruthy();
  reads.identity = { isPending: false, isError: true, data: true };
  rerenderFrame(<StyleCFrame>Page body</StyleCFrame>);
  expect(identityLink()).toBeNull();
});

it('keeps every guarded page out while nobody is signed in, and the always-visible pages in', () => {
  reads.userId = null;
  reads.identity = { isPending: false, data: true };
  renderFrame(<StyleCFrame>Page body</StyleCFrame>);
  expect(identityLink()).toBeNull();
  expect(panel().getByRole('link', { name: /Permissions/ })).toBeTruthy();
});
