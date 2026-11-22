import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, expect, it, vi } from 'vitest';

import { frameState, selectBusiness } from '../frames/frame-test-support';
import { useApprovalKinds } from './use-approval-kinds';

const api = vi.hoisted(() => ({ GET: vi.fn() }));
vi.mock('@/shared/api/client', () => ({ apiClient: () => api }));
vi.mock(
  'next/navigation',
  async () => (await import('../frames/frame-test-support')).navigationMock,
);
vi.mock(
  '@/shared/locale/locale-context',
  async () => (await import('../frames/frame-test-support')).localeMock,
);
vi.mock(
  './use-visible-page-ids',
  async () => (await import('../frames/frame-test-support')).visibleMock,
);
vi.mock(
  '@/workspace/model/workspace-provider',
  async () => (await import('../frames/frame-test-support')).workspaceMock,
);
vi.mock('@/session/api/use-session', () => ({ useSessionUser: () => 'user-1' }));

const EXCEPTIONS = '/v1/businesses/{businessId}/branches/{branchId}/attendance-exceptions';
const bodies: Record<string, unknown> = {
  '/v1/businesses/{businessId}/leave-requests': {
    items: [],
    next_cursor: null,
    request_branch_ids: [],
  },
  '/v1/businesses/{businessId}/attendance-change-requests': {
    can_decide_any: true,
    can_request: false,
    items: [],
    next_cursor: null,
  },
  [EXCEPTIONS]: { items: [], next_cursor: null },
};

function renderKinds() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return renderHook(() => useApprovalKinds(), { wrapper });
}

beforeEach(() => {
  api.GET.mockReset();
  selectBusiness('restaurant');
  frameState.visible = [
    'dashboard',
    'leave-approvals',
    'attendance-requests',
    'attendance-exceptions',
  ];
});

it('lists nothing while the page reads are still loading', () => {
  api.GET.mockReturnValue(new Promise(() => undefined));
  expect(renderKinds().result.current).toEqual([]);
});

it('does not link a user who is refused attendance exceptions to that page', async () => {
  api.GET.mockImplementation((path: string) =>
    Promise.resolve(
      path === EXCEPTIONS
        ? { error: { code: 'FORBIDDEN' }, response: { status: 403 } }
        : { data: bodies[path], response: { status: 200 } },
    ),
  );
  const { result } = renderKinds();
  await waitFor(() => expect(result.current).toHaveLength(2));
  expect(result.current.map((kind) => kind.href)).toEqual(['/staff/attendance-requests', '/leave']);
});

it('lists all three kinds once every page read succeeds', async () => {
  api.GET.mockImplementation((path: string) =>
    Promise.resolve({ data: bodies[path], response: { status: 200 } }),
  );
  const { result } = renderKinds();
  await waitFor(() => expect(result.current).toHaveLength(3));
});
