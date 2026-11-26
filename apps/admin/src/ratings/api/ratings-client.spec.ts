import { beforeEach, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({ GET: vi.fn() }));
vi.mock('@/shared/api/client', () => ({ apiClient: () => api }));

import { readRatingsAccess, readRatingAverages, readRatingsPage } from './ratings-client';

const listPath = '/v1/businesses/{businessId}/ratings';
const companyId = '01920000-0000-7000-8000-0000000000c1';
const businessId = '01920000-0000-7000-8000-0000000000b1';
const signal = new AbortController().signal;

/** رفض بلا جسم: 403 من البوابة ممكن يوصل من غير error object، فالحالة كلها في الـ status. */
const bodyless = (status: number) =>
  Promise.resolve({ data: undefined, error: undefined, response: new Response(null, { status }) });

beforeEach(() => api.GET.mockReset());

it('keeps the status of a bodyless refusal instead of failing on the missing body', async () => {
  api.GET.mockReturnValue(bodyless(403));
  await expect(
    readRatingsPage(companyId, businessId, { limit: 1 }, signal),
  ).rejects.toEqual({ status: 403 });
  api.GET.mockReturnValue(bodyless(403));
  await expect(
    readRatingAverages(companyId, businessId, {}, signal),
  ).rejects.toEqual({ status: 403 });
});

it('keeps the server message of a refusal that has a body', async () => {
  const failure = { code: 'FORBIDDEN', message_ar: 'مرفوض', message_en: 'Refused' };
  api.GET.mockResolvedValue({ error: failure, response: { status: 403, ok: false } });
  await expect(readRatingsPage(companyId, businessId, { limit: 1 }, signal)).rejects.toEqual({
    ...failure,
    status: 403,
  });
});

it('probes the access with an empty year-2000 window and answers with the permission alone', async () => {
  api.GET.mockResolvedValue({
    data: { items: [], next_cursor: null, month: null },
    response: { status: 200, ok: true },
  });
  await expect(readRatingsAccess(companyId, businessId, signal)).resolves.toEqual({
    allowed: true,
  });
  const [path, init] = api.GET.mock.calls[0] as [string, { params: { query: unknown } }];
  expect(path).toBe(listPath);
  expect(init.params.query).toEqual({
    from: '2000-01-01T00:00:00Z',
    to: '2000-01-01T00:00:00.000001Z',
    limit: 1,
  });
});
