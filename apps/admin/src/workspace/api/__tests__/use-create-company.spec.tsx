import type { ReactNode } from 'react';
import { act, renderHook } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, expect, it, vi } from 'vitest';
import { createQueryClient } from '@/shared/api/query-client';

import { companiesPath } from '../create-company-client';
import { useCreateCompany } from '../use-create-company';

const api = vi.hoisted(() => ({ GET: vi.fn(), POST: vi.fn() }));
vi.mock('@/shared/api/client', () => ({ apiClient: () => api }));

const BODY = { name_en: 'Rehearsal Salon', name_ar: 'صالون تجربة', plan_id: '01920000-0000-7000-8000-000000000001' };
const CHANGED_BODY = { ...BODY, name_en: 'Changed Salon' };
const CREATED = {
  id: '01920000-0000-7000-8000-000000000010',
  name_ar: 'صالون تجربة',
  name_en: 'Rehearsal Salon',
  owner_user_id: '01920000-0000-7000-8000-0000000000a1',
  plan_id: '01920000-0000-7000-8000-000000000001',
  created_at: '2026-11-24T09:00:00Z',
  deleted_at: null,
};

function answer(data: unknown, status: number) {
  return { data: status < 400 ? data : undefined, error: status < 400 ? undefined : data, response: { status, ok: status < 400 } };
}

function mount(client = createQueryClient()) {
  function wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  }
  return renderHook(() => useCreateCompany(), { wrapper });
}

function sentKey(call: number): string {
  return api.POST.mock.calls[call]?.[1].params.header['Idempotency-Key'];
}

beforeEach(() => {
  api.GET.mockReset();
  api.POST.mockReset();
});

it('sends the body and the header through the generated client path', async () => {
  const hook = mount();
  api.POST.mockResolvedValueOnce(answer(CREATED, 201));
  await act(async () => {
    await hook.result.current.mutateAsync(BODY);
  });
  expect(api.POST).toHaveBeenCalledTimes(1);
  expect(api.POST.mock.calls[0]?.[0]).toBe(companiesPath);
  expect(api.POST.mock.calls[0]?.[1].body).toEqual(BODY);
  expect(sentKey(0)).toMatch(/[0-9a-f-]{36}/);
});

it('reuses the idempotency key for the same body after a network failure', async () => {
  const hook = mount();
  api.POST.mockRejectedValueOnce(new TypeError('network died'));
  await act(async () => {
    await expect(hook.result.current.mutateAsync(BODY)).rejects.toThrow('network died');
  });
  const heldKey = sentKey(0);
  api.POST.mockResolvedValueOnce(answer(CREATED, 201));
  await act(async () => {
    await hook.result.current.mutateAsync(BODY);
  });
  expect(sentKey(1)).toBe(heldKey);
});

it('a 403 refusal releases the key so the next attempt uses a new one', async () => {
  const hook = mount();
  api.POST.mockResolvedValueOnce(
    answer(
      { code: 'FORBIDDEN', message_ar: 'ممنوع', message_en: 'Forbidden' },
      403,
    ),
  );
  await act(async () => {
    await expect(hook.result.current.mutateAsync(BODY)).rejects.toMatchObject({ status: 403 });
  });
  const refusedKey = sentKey(0);
  api.POST.mockResolvedValueOnce(answer(CREATED, 201));
  await act(async () => {
    await hook.result.current.mutateAsync(BODY);
  });
  expect(sentKey(1)).not.toBe(refusedKey);
});

it('a 409 in-progress answer keeps the key so the retry reuses it', async () => {
  const hook = mount();
  api.POST.mockResolvedValueOnce(
    answer(
      { code: 'IDEMPOTENCY_KEY_IN_PROGRESS', message_ar: 'قيد التنفيذ', message_en: 'In progress' },
      409,
    ),
  );
  await act(async () => {
    await expect(hook.result.current.mutateAsync(BODY)).rejects.toMatchObject({ status: 409 });
  });
  const heldKey = sentKey(0);
  api.POST.mockResolvedValueOnce(answer(CREATED, 201));
  await act(async () => {
    await hook.result.current.mutateAsync(BODY);
  });
  expect(sentKey(1)).toBe(heldKey);
});

it('a 5xx keeps the key because the request may have committed', async () => {
  const hook = mount();
  api.POST.mockResolvedValueOnce(
    answer({ code: 'UNEXPECTED', message_ar: 'خطأ', message_en: 'Unexpected' }, 500),
  );
  await act(async () => {
    await expect(hook.result.current.mutateAsync(BODY)).rejects.toMatchObject({ status: 500 });
  });
  const heldKey = sentKey(0);
  api.POST.mockResolvedValueOnce(answer(CREATED, 201));
  await act(async () => {
    await hook.result.current.mutateAsync(BODY);
  });
  expect(sentKey(1)).toBe(heldKey);
});

it('changed values take a new key', async () => {
  const hook = mount();
  api.POST.mockRejectedValueOnce(new TypeError('network died'));
  await act(async () => {
    await expect(hook.result.current.mutateAsync(BODY)).rejects.toThrow('network died');
  });
  const heldKey = sentKey(0);
  api.POST.mockResolvedValueOnce(answer(CREATED, 201));
  await act(async () => {
    await hook.result.current.mutateAsync(CHANGED_BODY);
  });
  expect(sentKey(1)).not.toBe(heldKey);
});

it('a successful create marks the workspaces read stale', async () => {
  const client = createQueryClient();
  client.setQueryData(['me', 'workspaces'], { companies: [] });
  function wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  }
  const hook = renderHook(() => useCreateCompany(), { wrapper });
  api.POST.mockResolvedValueOnce(answer(CREATED, 201));
  await act(async () => {
    await hook.result.current.mutateAsync(BODY);
  });
  const query = client.getQueryState(['me', 'workspaces']);
  expect(query?.isInvalidated).toBe(true);
});
