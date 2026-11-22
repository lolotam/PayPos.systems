import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, expect, it, vi } from 'vitest';

import { useApprovalKindAccess, type ApprovalAccessScope } from './use-approval-kind-access';

const api = vi.hoisted(() => ({ GET: vi.fn() }));
vi.mock('@/shared/api/client', () => ({ apiClient: () => api }));

const scope: ApprovalAccessScope = {
  companyId: 'company-1',
  businessId: 'business-1',
  branchId: 'branch-1',
  userId: 'user-1',
};

const LEAVE = '/v1/businesses/{businessId}/leave-requests';
const REQUESTS = '/v1/businesses/{businessId}/attendance-change-requests';
const EXCEPTIONS = '/v1/businesses/{businessId}/branches/{branchId}/attendance-exceptions';

const bodies: Record<string, unknown> = {
  [LEAVE]: { items: [], next_cursor: null, request_branch_ids: [] },
  [REQUESTS]: { can_decide_any: true, can_request: false, items: [], next_cursor: null },
  [EXCEPTIONS]: { items: [], next_cursor: null },
};

function answer(denied: readonly string[] = []) {
  api.GET.mockImplementation((path: string) =>
    Promise.resolve(
      denied.includes(path)
        ? { error: { code: 'FORBIDDEN' }, response: { status: 403 } }
        : { data: bodies[path], response: { status: 200 } },
    ),
  );
}

function renderAccess(next: ApprovalAccessScope | null, client = new QueryClient()) {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return renderHook(() => useApprovalKindAccess(next), { wrapper });
}

beforeEach(() => {
  api.GET.mockReset();
});

it('says no for every kind until its own read has answered', () => {
  api.GET.mockReturnValue(new Promise(() => undefined));
  expect(renderAccess(scope).result.current).toEqual({
    'leave-approvals': false,
    'attendance-requests': false,
    'attendance-exceptions': false,
  });
});

it('says yes for the kinds whose page read succeeds', async () => {
  answer();
  const { result } = renderAccess(scope);
  await waitFor(() => expect(result.current['attendance-exceptions']).toBe(true));
  expect(result.current).toEqual({
    'leave-approvals': true,
    'attendance-requests': true,
    'attendance-exceptions': true,
  });
});

it('says no for a kind whose page read is refused, and keeps the others', async () => {
  answer([EXCEPTIONS]);
  const { result } = renderAccess(scope);
  await waitFor(() => expect(result.current['leave-approvals']).toBe(true));
  await waitFor(() => expect(api.GET).toHaveBeenCalledTimes(3));
  expect(result.current['attendance-exceptions']).toBe(false);
  expect(result.current['attendance-requests']).toBe(true);
});

it('asks nothing for the attendance kinds when the business has no branch', async () => {
  answer();
  const { result } = renderAccess({ ...scope, branchId: undefined });
  await waitFor(() => expect(result.current['leave-approvals']).toBe(true));
  expect(result.current['attendance-requests']).toBe(false);
  expect(result.current['attendance-exceptions']).toBe(false);
  expect(api.GET).toHaveBeenCalledTimes(1);
});

it('asks nothing without a selected business', () => {
  answer();
  const { result } = renderAccess(null);
  expect(api.GET).not.toHaveBeenCalled();
  expect(Object.values(result.current)).toEqual([false, false, false]);
});

function respond(exceptionsStatus: number) {
  api.GET.mockImplementation((path: string) =>
    Promise.resolve(
      path === EXCEPTIONS && exceptionsStatus !== 200
        ? { error: { code: 'DENIED' }, response: { status: exceptionsStatus } }
        : { data: bodies[path], response: { status: 200 } },
    ),
  );
}

it('does not reuse the proof of an earlier visit after the permission was revoked', async () => {
  const client = new QueryClient();
  respond(200);
  const first = renderAccess(scope, client);
  await waitFor(() => expect(first.result.current['attendance-exceptions']).toBe(true));
  first.unmount();
  respond(403);
  const second = renderAccess(scope, client);
  expect(second.result.current['attendance-exceptions']).toBe(false);
  await waitFor(() => expect(api.GET).toHaveBeenCalledTimes(6));
  await waitFor(() => expect(second.result.current['leave-approvals']).toBe(true));
  expect(second.result.current['attendance-exceptions']).toBe(false);
});

it('keeps a kind hidden when its read fails with a server error rather than a refusal', async () => {
  respond(500);
  const { result } = renderAccess(scope);
  await waitFor(() => expect(result.current['leave-approvals']).toBe(true));
  await waitFor(() => expect(api.GET).toHaveBeenCalledTimes(3));
  expect(result.current['attendance-exceptions']).toBe(false);
});
