import type { WorkspaceController } from '@/workspace/model/workspace-provider';
import { renderHook } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';

import { useVisibilityConditions } from './use-visibility-conditions';

type Read = { isSuccess?: boolean; isPending?: boolean; isError?: boolean; data?: unknown };
const state = vi.hoisted(() => ({
  userId: 'user' as string | null,
  workspace: undefined as WorkspaceController | undefined,
  alerts: {} as Read,
  rating: {} as Read,
  identity: {} as Read,
  employees: {} as Read,
  denied: false,
  appLink: {} as Read,
  refunds: {} as Read & { isFetchedAfterMount?: boolean },
  ratings: {} as Read & { isFetchedAfterMount?: boolean },
  leave: { allowed: false } as { allowed: boolean },
  columns: {} as Read,
  invitations: {
    isSuccess: true,
    isFetchedAfterMount: true,
    isError: false,
  } as Read & { isFetchedAfterMount?: boolean },
}));

vi.mock('@/shared/browser/use-mounted', () => ({ useMounted: () => true }));
vi.mock('@/session/api/use-session', () => ({ useSessionUser: () => state.userId }));
vi.mock('@/workspace/model/workspace-provider', () => ({ useWorkspace: () => state.workspace }));
vi.mock('@/settings/alert-rules/api/use-alert-rules', () => ({
  useAlertRules: () => state.alerts,
}));
vi.mock('@/settings/alert-rules/api/use-rating-settings', () => ({
  useRatingSettings: () => state.rating,
}));
vi.mock('@/business-identity/api/use-business-identity-access', () => ({
  useBusinessIdentityAccess: () => state.identity,
}));
vi.mock('@/commissions/api/plan-access', () => ({
  planScope: (...parts: string[]) => ['commission-plans', ...parts],
  usePlanAccess: () => ({ denied: state.denied, generation: 0 }),
}));
vi.mock('@/commissions/api/use-commission-plan-employees', () => ({
  useCommissionPlanEmployees: () => state.employees,
}));
vi.mock('@/staff/api/use-employee-app-link', () => ({ useEmployeeAppLink: () => state.appLink }));
vi.mock('@/settings/imported-refunds/api/use-imported-refunds', () => ({
  useImportedRefunds: () => state.refunds,
}));
vi.mock('@/ratings/api/use-ratings-access', () => ({ useRatingsAccess: () => state.ratings }));
vi.mock('@/staff/api/use-leave-report-access', () => ({ useLeaveReportAccess: () => state.leave }));
vi.mock('@/settings/staff-app-columns/api/use-staff-columns', () => ({
  useStaffColumns: () => state.columns,
}));
vi.mock('@/permissions/api/use-invitations-access', () => ({
  useInvitationsAccess: () => state.invitations,
}));

const id = '01920000-0000-7000-8000-0000000000a2';

beforeEach(() => {
  state.userId = 'user';
  state.alerts = { isSuccess: false };
  state.rating = { isSuccess: false };
  state.identity = { isPending: false, data: false };
  state.employees = {};
  state.denied = false;
  state.appLink = { isSuccess: false };
  state.refunds = { isSuccess: false, isError: false, isFetchedAfterMount: false };
  state.ratings = { isSuccess: false, isError: false, isFetchedAfterMount: false };
  state.leave = { allowed: false };
  state.columns = { isPending: true, isError: false };
  state.invitations = { isSuccess: true, isFetchedAfterMount: true, isError: false };
  state.workspace = {
    status: 'ready',
    company: {
      id,
      name_ar: null,
      name_en: 'Co',
      businesses: [],
      role_code: 'owner',
      scope: 'COMPANY',
    },
    business: {
      id,
      name_ar: null,
      name_en: 'Biz',
      business_type: 'salon',
      country: 'KW',
      branches: [],
    },
    branch: undefined,
    companies: [],
    choose: vi.fn(),
  };
});

const conditions = () => renderHook(() => useVisibilityConditions()).result.current;

it('keeps every guarded condition closed while the reads are loading', () => {
  expect(conditions()).toEqual({
    always: true,
    'alert-rules-or-rating-access': false,
    'business-identity-access': false,
    'commission-plans-access': false,
    'employee-app-link-access': false,
    'imported-refunds-access': false,
    // الدور جاي من الـ workspace الجاهز، والقراءة الرخيصة متأكدة في الـ fixture — فالشرط مفتوح.
    'invitations-owner': true,
    'leave-report-access': false,
    'ratings-access': false,
    'staff-app-columns-access': false,
  });
});

it('hides the invitations entry when the API answers NOT_READY while the gate is off', () => {
  // 503 من بوابة شريحة 076: readAccessProof بيرجّع failed فالمدخل يختفي بدل صفحة معطوبة.
  state.invitations = {
    isSuccess: false,
    isFetchedAfterMount: false,
    isError: true,
  } as Read & { isFetchedAfterMount?: boolean };
  expect(conditions()['invitations-owner']).toBe(false);
});

it('opens the alert-rules condition when either read succeeds', () => {
  state.rating = { isSuccess: true };
  expect(conditions()['alert-rules-or-rating-access']).toBe(true);
  state.rating = { isSuccess: false };
  state.alerts = { isSuccess: true };
  expect(conditions()['alert-rules-or-rating-access']).toBe(true);
});

it('opens business identity only when the capability read says true', () => {
  state.identity = { data: true };
  expect(conditions()['business-identity-access']).toBe(true);
  state.identity = { data: false };
  expect(conditions()['business-identity-access']).toBe(false);
});

it('hides business identity after a failed refetch even though the cached answer was true', () => {
  state.identity = { data: true, isPending: false, isError: true };
  expect(conditions()['business-identity-access']).toBe(false);
  state.identity = { data: true, isPending: false, isError: false };
  expect(conditions()['business-identity-access']).toBe(true);
});

it('opens commission plans on saved employees and closes them when access is denied', () => {
  state.employees = { data: [] };
  expect(conditions()['commission-plans-access']).toBe(true);
  state.denied = true;
  expect(conditions()['commission-plans-access']).toBe(false);
});

it('opens imported refunds only after a fresh granted read', () => {
  state.refunds = { isSuccess: true, isFetchedAfterMount: false };
  expect(conditions()['imported-refunds-access']).toBe(false);
  state.refunds = { isSuccess: true, isFetchedAfterMount: true };
  expect(conditions()['imported-refunds-access']).toBe(true);
});

it('opens ratings only after a fresh granted read, and closes it again when a later read fails', () => {
  state.ratings = { isSuccess: true, isFetchedAfterMount: false };
  expect(conditions()['ratings-access']).toBe(false);
  state.ratings = { isSuccess: true, isFetchedAfterMount: true };
  expect(conditions()['ratings-access']).toBe(true);
  state.ratings = { isSuccess: false, isError: true, isFetchedAfterMount: true };
  expect(conditions()['ratings-access']).toBe(false);
});

it('opens staff app columns unless the read is pending or failed', () => {
  state.columns = { isPending: false, isError: false };
  expect(conditions()['staff-app-columns-access']).toBe(true);
  state.columns = { isPending: false, isError: true };
  expect(conditions()['staff-app-columns-access']).toBe(false);
});

it('opens the app link and leave report conditions from their own reads', () => {
  state.appLink = { isSuccess: true };
  state.leave = { allowed: true };
  const result = conditions();
  expect(result['employee-app-link-access']).toBe(true);
  expect(result['leave-report-access']).toBe(true);
});

it('closes every guarded condition when no business is selected or nobody is signed in', () => {
  state.identity = { data: true };
  state.appLink = { isSuccess: true };
  state.userId = null;
  expect(conditions()['business-identity-access']).toBe(false);
  state.userId = 'user';
  state.workspace = { status: 'choose', companies: [], choose: vi.fn() };
  const result = conditions();
  expect(result['employee-app-link-access']).toBe(false);
  expect(result.always).toBe(true);
});
