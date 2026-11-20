import type { ReactNode } from 'react';
import type { Service } from '@pospay/contracts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { useServiceClosing } from './use-service-closing';
import { useServiceEdit } from './use-services';

const get = vi.hoisted(() => vi.fn());
const post = vi.hoisted(() => vi.fn());
vi.mock('@/shared/api/client', () => ({ apiClient: () => ({ GET: get, POST: post }) }));

const companyId = '01920000-0000-7000-8000-000000000001';
const businessId = '01920000-0000-7000-8000-000000000002';
const userId = '01920000-0000-7000-8000-000000000003';
const serviceId = '01920000-0000-7000-8000-0000000000a1';
const detailRoute = '/v1/businesses/{businessId}/services/{serviceId}';

function serviceRecord(overrides: Partial<Service> = {}): Service {
  return {
    id: serviceId,
    business_id: businessId,
    name_en: 'Hair cut',
    name_ar: 'Hair cut AR',
    price: '12.500',
    commission_rule: { kind: 'FOLLOW_PLAN' },
    counts_toward_threshold: true,
    duration_minutes: 90,
    category_id: null,
    category: null,
    closed_at: null,
    revision: 1,
    created_at: '2026-10-01T10:00:00Z',
    updated_at: '2026-10-01T10:00:00Z',
    ...overrides,
  };
}

function createQueryClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
}

function errorCode(error: unknown): string {
  return typeof error === 'object' && error !== null && 'code' in error
    ? String((error as { code: unknown }).code)
    : 'none';
}

// بروب بيقرا تفاصيل الخدمة من نفس مفتاح الكاش اللي الهوك بيكتب فيه، فالـclosed_at الظاهر بعد 200
// ميرجعش من الـGET (اللي بيرد السجل المفتوح بس) — رجع من كتابة الرد في الكاش.
function ClosingProbe({
  companyId: cid,
  businessId: bid,
  userId: uid,
  serviceId: sid,
  action,
}: {
  companyId: string;
  businessId: string;
  userId: string;
  serviceId: string;
  action: 'close' | 'reopen';
}) {
  const { record } = useServiceEdit(cid, bid, uid, sid);
  const closing = useServiceClosing(cid, bid, uid, sid);
  return (
    <div>
      <p>closed-at:{record.data?.closed_at ?? 'open'}</p>
      <p>error-code:{errorCode(closing.error)}</p>
      <button
        disabled={closing.isPending || !record.data}
        onClick={() => {
          if (record.data) closing.mutate({ action, expectedRevision: record.data.revision });
        }}
      >
        run
      </button>
    </div>
  );
}

function renderProbe(client: QueryClient, action: 'close' | 'reopen') {
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  }
  render(
    <ClosingProbe
      companyId={companyId}
      businessId={businessId}
      userId={userId}
      serviceId={serviceId}
      action={action}
    />,
    { wrapper: Wrapper },
  );
}

function mockDetailOnce(record: Service) {
  let reads = 0;
  get.mockImplementation((path: string) => {
    if (path === detailRoute) {
      reads += 1;
      return Promise.resolve({ data: record, response: { status: 200 } });
    }
    return Promise.resolve({ data: {}, response: { status: 200 } });
  });
  return () => reads;
}

beforeEach(() => {
  get.mockReset();
  post.mockReset();
});

it.each([
  {
    action: 'close' as const,
    route: '/v1/businesses/{businessId}/services/{serviceId}/close',
    initial: serviceRecord(),
    answer: serviceRecord({ closed_at: '2026-11-20T10:00:00Z', revision: 2 }),
  },
  {
    action: 'reopen' as const,
    route: '/v1/businesses/{businessId}/services/{serviceId}/reopen',
    initial: serviceRecord({ closed_at: '2026-11-19T09:00:00Z', revision: 2 }),
    answer: serviceRecord({ revision: 3 }),
  },
])(
  'a $action with 200 writes the answer into the detail cache and posts expected_revision',
  async ({ action, route, initial, answer }) => {
    const readsCount = mockDetailOnce(initial);
    post.mockResolvedValueOnce({ data: answer, response: { status: 200 } });
    renderProbe(createQueryClient(), action);
    const initialText = `closed-at:${initial.closed_at ?? 'open'}`;
    await waitFor(() => expect(screen.getByText(initialText)).toBeTruthy());
    await waitFor(() =>
      expect((screen.getByRole('button', { name: 'run' }) as HTMLButtonElement).disabled).toBe(
        false,
      ),
    );
    fireEvent.click(screen.getByRole('button', { name: 'run' }));
    await waitFor(() =>
      expect(screen.getByText(`closed-at:${answer.closed_at ?? 'open'}`)).toBeTruthy(),
    );
    expect(post).toHaveBeenCalledWith(route, {
      params: { header: { 'x-company-id': companyId }, path: { businessId, serviceId } },
      body: { expected_revision: initial.revision },
    });
    expect(readsCount()).toBe(1);
  },
);

it('a 409 SERVICE_REVISION_CONFLICT shows the code, refetches the detail, and the badge follows the server', async () => {
  let reads = 0;
  get.mockImplementation((path: string) => {
    if (path === detailRoute) {
      reads += 1;
      return Promise.resolve({
        data:
          reads === 1
            ? serviceRecord()
            : serviceRecord({ closed_at: '2026-11-20T11:00:00Z', revision: 2 }),
        response: { status: 200 },
      });
    }
    return Promise.resolve({ data: {}, response: { status: 200 } });
  });
  post.mockResolvedValueOnce({
    error: { code: 'SERVICE_REVISION_CONFLICT', message_ar: 'Conflict AR', message_en: 'Conflict' },
    response: { status: 409 },
  });
  renderProbe(createQueryClient(), 'close');
  await waitFor(() => expect(screen.getByText('closed-at:open')).toBeTruthy());
  await waitFor(() =>
    expect((screen.getByRole('button', { name: 'run' }) as HTMLButtonElement).disabled).toBe(false),
  );
  fireEvent.click(screen.getByRole('button', { name: 'run' }));
  await waitFor(() =>
    expect(screen.getByText('error-code:SERVICE_REVISION_CONFLICT')).toBeTruthy(),
  );
  await waitFor(() => expect(reads).toBe(2));
  await waitFor(() => expect(screen.getByText('closed-at:2026-11-20T11:00:00Z')).toBeTruthy());
});

it('a 403 shows the code and leaves the detail read untouched', async () => {
  let reads = 0;
  get.mockImplementation((path: string) => {
    if (path === detailRoute) {
      reads += 1;
      return Promise.resolve({ data: serviceRecord(), response: { status: 200 } });
    }
    return Promise.resolve({ data: {}, response: { status: 200 } });
  });
  post.mockResolvedValueOnce({
    error: { code: 'FORBIDDEN', message_ar: 'Forbidden AR', message_en: 'Forbidden' },
    response: { status: 403 },
  });
  renderProbe(createQueryClient(), 'reopen');
  await waitFor(() => expect(screen.getByText('closed-at:open')).toBeTruthy());
  await waitFor(() =>
    expect((screen.getByRole('button', { name: 'run' }) as HTMLButtonElement).disabled).toBe(false),
  );
  fireEvent.click(screen.getByRole('button', { name: 'run' }));
  await waitFor(() => expect(screen.getByText('error-code:FORBIDDEN')).toBeTruthy());
  expect(reads).toBe(1);
});
