import type { ReactNode } from 'react';
import type { ServiceCategoryClosingAction, ServiceCategoryClosingStatus } from '@pospay/contracts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  useServiceCategoryClosing,
  useServiceCategoryClosingStatus,
} from './use-service-category-closing';
import { useServiceCategoryList } from './use-service-category-list';

const get = vi.hoisted(() => vi.fn());
const post = vi.hoisted(() => vi.fn());
vi.mock('@/shared/api/client', () => ({
  apiClient: () => ({ GET: get, POST: post }),
}));

const companyId = '01920000-0000-7000-8000-000000000001';
const businessId = '01920000-0000-7000-8000-000000000002';
const userId = '01920000-0000-7000-8000-000000000003';
const categoryId = '01920000-0000-7000-8000-0000000000c1';
const closingId = '01920000-0000-7000-8000-000000000099';

function createQueryClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
}

function createWrapper(client: QueryClient = createQueryClient()) {
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

function statusRecord(
  overrides: Partial<ServiceCategoryClosingStatus> = {},
): ServiceCategoryClosingStatus {
  return {
    closing_id: closingId,
    category_id: categoryId,
    action: 'close',
    status: 'pending',
    services_changed: null,
    error_code: null,
    requested_at: '2026-10-05T10:00:00Z',
    finished_at: null,
    ...overrides,
  };
}

const renderStatusHook = (client?: QueryClient) =>
  renderHook(
    () =>
      useServiceCategoryClosingStatus(companyId, businessId, userId, categoryId, closingId, 2_000),
    { wrapper: createWrapper(client) },
  );

const renderListAndStatusHook = (client: QueryClient) =>
  renderHook(
    () => ({
      list: useServiceCategoryList(companyId, businessId, userId, { status: 'open' }),
      status: useServiceCategoryClosingStatus(
        companyId,
        businessId,
        userId,
        categoryId,
        closingId,
        2_000,
      ),
    }),
    { wrapper: createWrapper(client) },
  );

const closingMutationCases = [
  {
    action: 'close' as ServiceCategoryClosingAction,
    status: 200,
    responseBody: {
      id: categoryId,
      name_en: 'Hair',
      name_ar: 'Hair (ar)',
      visibility: 'BUSINESS',
      owner_branch_id: null,
      closed_at: '2026-10-05T10:00:00Z',
      revision: 2,
      services_closed: 5,
    },
    expectedRoute: '/v1/businesses/{businessId}/service-categories/{categoryId}/close',
    expectedBody: { expected_revision: 1, expected_service_count: 5 },
    expectedResult: { kind: 'done', action: 'close', servicesChanged: 5 },
  },
  {
    action: 'close' as ServiceCategoryClosingAction,
    status: 202,
    responseBody: { closing_id: closingId, status: 'pending' },
    expectedRoute: '/v1/businesses/{businessId}/service-categories/{categoryId}/close',
    expectedBody: { expected_revision: 1, expected_service_count: 450 },
    expectedResult: { kind: 'pending', action: 'close', closingId },
  },
  {
    action: 'reopen' as ServiceCategoryClosingAction,
    status: 200,
    responseBody: {
      id: categoryId,
      name_en: 'Hair',
      name_ar: 'Hair (ar)',
      visibility: 'BUSINESS',
      owner_branch_id: null,
      closed_at: null,
      revision: 3,
      services_reopened: 8,
    },
    expectedRoute: '/v1/businesses/{businessId}/service-categories/{categoryId}/reopen',
    expectedBody: { expected_revision: 2, expected_service_count: 8 },
    expectedResult: { kind: 'done', action: 'reopen', servicesChanged: 8 },
  },
  {
    action: 'reopen' as ServiceCategoryClosingAction,
    status: 202,
    responseBody: { closing_id: closingId, status: 'pending' },
    expectedRoute: '/v1/businesses/{businessId}/service-categories/{categoryId}/reopen',
    expectedBody: { expected_revision: 2, expected_service_count: 8 },
    expectedResult: { kind: 'pending', action: 'reopen', closingId },
  },
];

beforeEach(() => {
  get.mockReset();
  post.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

it.each(closingMutationCases)(
  '$action with $status resolves expected result and posts to $expectedRoute',
  async ({ action, status, responseBody, expectedRoute, expectedBody, expectedResult }) => {
    post.mockResolvedValueOnce({ data: responseBody, response: { status } });
    const hook = renderHook(() => useServiceCategoryClosing(companyId, businessId, userId), {
      wrapper: createWrapper(),
    });
    let result: unknown;
    await act(async () => {
      result = await hook.result.current.mutateAsync({ categoryId, action, ...expectedBody });
    });
    expect(result).toEqual(expectedResult);
    expect(post).toHaveBeenCalledWith(expectedRoute, {
      params: { header: { 'x-company-id': companyId }, path: { businessId, categoryId } },
      body: expectedBody,
    });
  },
);

it('polls while pending and stops polling once completed', async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  let readCount = 0;
  get.mockImplementation((path: string) => {
    if (!path.includes('/closings/'))
      return Promise.resolve({ data: {}, response: { status: 200 } });
    readCount += 1;
    return Promise.resolve({
      data:
        readCount === 1
          ? statusRecord({ status: 'pending' })
          : statusRecord({
              status: 'completed',
              services_changed: 450,
              finished_at: '2026-10-05T10:00:05Z',
            }),
      response: { status: 200 },
    });
  });

  const hook = renderStatusHook();
  await waitFor(() => expect(hook.result.current.data?.status).toBe('pending'));
  expect(readCount).toBe(1);

  await act(async () => {
    await vi.advanceTimersByTimeAsync(2_100);
  });
  await waitFor(() => expect(hook.result.current.data?.status).toBe('completed'));
  expect(readCount).toBe(2);
  expect(hook.result.current.data?.services_changed).toBe(450);

  await act(async () => {
    await vi.advanceTimersByTimeAsync(6_300);
  });
  expect(readCount).toBe(2);
  expect(hook.result.current.data?.status).toBe('completed');
});

it.each([
  [404, 'SERVICE_CATEGORY_CLOSING_NOT_FOUND'],
  [403, 'FORBIDDEN'],
])('stops polling and performs no retries on a %i status response (%s)', async (status, code) => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  get.mockResolvedValueOnce({
    error: { code, message_ar: 'Error (ar)', message_en: 'Error' },
    response: { status },
  });

  const hook = renderStatusHook();
  await waitFor(() => expect(hook.result.current.isError).toBe(true));
  expect(get).toHaveBeenCalledTimes(1);

  await act(async () => {
    await vi.advanceTimersByTimeAsync(6_300);
  });
  expect(get).toHaveBeenCalledTimes(1);
});

it('refetches the category list query exactly once when status becomes completed', async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  let statusCallCount = 0;
  get.mockImplementation((path: string) => {
    if (path === '/v1/businesses/{businessId}/service-categories') {
      return Promise.resolve({ data: { items: [], next_cursor: null }, response: { status: 200 } });
    }
    if (path.includes('/closings/')) {
      statusCallCount += 1;
      return Promise.resolve({
        data:
          statusCallCount === 1
            ? statusRecord({ status: 'pending' })
            : statusRecord({
                status: 'completed',
                services_changed: 450,
                finished_at: '2026-10-05T10:00:05Z',
              }),
        response: { status: 200 },
      });
    }
    return Promise.resolve({ data: {}, response: { status: 200 } });
  });

  const client = createQueryClient();
  const hook = renderListAndStatusHook(client);

  await waitFor(() => expect(hook.result.current.list.isSuccess).toBe(true));
  await waitFor(() => expect(hook.result.current.status.isSuccess).toBe(true));

  const listCalls = () =>
    get.mock.calls.filter(([path]) => path === '/v1/businesses/{businessId}/service-categories');

  expect(listCalls().length).toBe(1);
  expect(statusCallCount).toBe(1);

  await act(async () => {
    await vi.advanceTimersByTimeAsync(2_100);
  });
  await waitFor(() => expect(hook.result.current.status.data?.status).toBe('completed'));
  await waitFor(() => expect(listCalls().length).toBe(2));

  await act(async () => {
    await vi.advanceTimersByTimeAsync(6_300);
  });
  expect(listCalls().length).toBe(2);
  expect(statusCallCount).toBe(2);
});
