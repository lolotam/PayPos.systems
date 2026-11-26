import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { readAccessProof } from '@/shared/api/read-access-proof';
import { useRatingsAccess } from './use-ratings-access';

const api = vi.hoisted(() => ({ GET: vi.fn() }));
vi.mock('@/shared/api/client', () => ({ apiClient: () => api }));

const companyId = '01920000-0000-7000-8000-0000000000c1';
const businessId = '01920000-0000-7000-8000-0000000000b1';
const userId = '01920000-0000-7000-8000-0000000000e1';
const accessKey = ['ratings', companyId, userId, businessId, 'access'];

function Probe() {
  const access = useRatingsAccess(companyId, userId, businessId);
  return <span role="status">{readAccessProof(access)}</span>;
}

function renderProbe() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <Probe />
    </QueryClientProvider>,
  );
  return client;
}

beforeEach(() => api.GET.mockReset());

it('keeps only the permission in the navigation cache and never a rating row', async () => {
  api.GET.mockResolvedValue({
    data: { items: [], next_cursor: null, month: null },
    response: { status: 200, ok: true },
  });
  const client = renderProbe();
  expect(await screen.findByText('granted')).toBeTruthy();
  expect(client.getQueryData(accessKey)).toEqual({ allowed: true });
  expect(JSON.stringify(client.getQueryData(accessKey))).not.toMatch(/items|comment/);
  expect(api.GET.mock.calls[0]?.[1].params.query).toEqual({
    from: '2000-01-01T00:00:00Z',
    to: '2000-01-01T00:00:00.000001Z',
    limit: 1,
  });
});

it('reads a bodyless refusal as a refusal, so the entry stays hidden and nothing is cached', async () => {
  api.GET.mockResolvedValue({
    data: undefined,
    error: undefined,
    response: new Response(null, { status: 403 }),
  });
  const client = renderProbe();
  expect(await screen.findByText('refused')).toBeTruthy();
  expect(client.getQueryData(accessKey)).toBeUndefined();
});
