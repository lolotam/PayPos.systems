import type { ReactNode } from 'react';
import { act, renderHook } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, expect, it, vi } from 'vitest';
import { createQueryClient } from '@/shared/api/query-client';

import { useCreateCompany } from '../use-create-company';

const api = vi.hoisted(() => ({ GET: vi.fn(), POST: vi.fn() }));
vi.mock('@/shared/api/client', () => ({ apiClient: () => api }));

const PLAN_ID = '01920000-0000-7000-8000-000000000001';
const BODY = { name_en: 'Rehearsal Salon', name_ar: 'Salon Rehearsal', plan_id: PLAN_ID };
const CHANGED_BODY = { ...BODY, name_en: 'Changed Salon' };
const CREATED = {
  id: '01920000-0000-7000-8000-000000000010',
  name_ar: 'Salon Rehearsal',
  name_en: 'Rehearsal Salon',
  owner_user_id: '01920000-0000-7000-8000-0000000000a1',
  plan_id: PLAN_ID,
  created_at: '2026-11-24T09:00:00Z',
  deleted_at: null,
};
const PATH = '/v1/companies';
const STORAGE_NAME = 'pospay.admin.create-company-attempt';
const USER = '01920000-0000-7000-8000-0000000000b1';

function answer(data: unknown, status: number) {
  return { data: status < 400 ? data : undefined, error: status < 400 ? undefined : data, response: { status, ok: status < 400 } };
}

function mount(client = createQueryClient(), userId = USER) {
  function wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  }
  return renderHook(() => useCreateCompany(userId), { wrapper });
}

function sentKey(call: number): string {
  return api.POST.mock.calls[call]?.[1].params.header['Idempotency-Key'];
}

function storedRaw(): string | null {
  return window.localStorage.getItem(STORAGE_NAME);
}

function seedAttempt(overrides: { userId?: string; startedAt?: string } = {}): void {
  window.localStorage.setItem(
    STORAGE_NAME,
    JSON.stringify({
      userId: USER,
      key: '01920000-0000-7000-8000-0000000000f1',
      body: BODY,
      startedAt: new Date().toISOString(),
      ...overrides,
    }),
  );
}

beforeEach(() => {
  api.GET.mockReset();
  api.POST.mockReset();
  window.localStorage.clear();
  // القراءة الافتراضية لمساحات العمل في هذا الملف فاضية، فحارس القراءة قبل الإرسال يسمح بالطلب إلا في الاختبارات التي تغيّرها.
  // الـ response موجود زي ما عميل OpenAPI الحقيقي بيرجّعه دايمًا (fetchWorkspaces بيقرا ok).
  api.GET.mockResolvedValue({
    data: { companies: [], capabilities: { staff_access: false } },
    response: { status: 200, ok: true },
  });
});

it('sends the body and the header through the generated client path', async () => {
  const hook = mount();
  api.POST.mockResolvedValueOnce(answer(CREATED, 201));
  await act(async () => {
    await hook.result.current.mutateAsync({ kind: 'new', body: BODY });
  });
  expect(api.POST).toHaveBeenCalledTimes(1);
  expect(api.POST.mock.calls[0]?.[0]).toBe(PATH);
  expect(api.POST.mock.calls[0]?.[1].body).toEqual(BODY);
  expect(sentKey(0)).toMatch(/[0-9a-f-]{36}/);
});

it('stores the attempt before the request and keeps it after a network failure', async () => {
  const hook = mount();
  expect(storedRaw()).toBeNull();
  api.POST.mockRejectedValueOnce(new TypeError('network died'));
  await act(async () => {
    await expect(hook.result.current.mutateAsync({ kind: 'new', body: BODY })).rejects.toThrow(
      'network died',
    );
  });
  const stored = JSON.parse(storedRaw() ?? '{}') as { userId?: string; key?: string };
  expect(stored.userId).toBe(USER);
  expect(stored.key).toBe(sentKey(0));
});

it('a retry resends the same stored key and body', async () => {
  const hook = mount();
  api.POST.mockRejectedValueOnce(new TypeError('network died'));
  await act(async () => {
    await expect(hook.result.current.mutateAsync({ kind: 'new', body: BODY })).rejects.toThrow(
      'network died',
    );
  });
  const heldKey = sentKey(0);
  api.POST.mockResolvedValueOnce(answer(CREATED, 201));
  await act(async () => {
    await hook.result.current.mutateAsync({ kind: 'retry' });
  });
  expect(api.POST.mock.calls[1]?.[0]).toBe(PATH);
  expect(api.POST.mock.calls[1]?.[1].body).toEqual(BODY);
  expect(sentKey(1)).toBe(heldKey);
});

it('a second submit while an attempt is undecided is refused, not sent', async () => {
  const hook = mount();
  api.POST.mockRejectedValueOnce(new TypeError('network died'));
  await act(async () => {
    await expect(hook.result.current.mutateAsync({ kind: 'new', body: BODY })).rejects.toThrow(
      'network died',
    );
  });
  await act(async () => {
    await expect(hook.result.current.mutateAsync({ kind: 'new', body: CHANGED_BODY })).rejects.toThrow(
      'undecided',
    );
  });
  expect(api.POST).toHaveBeenCalledTimes(1);
});

it('a 403 refusal releases the key and clears the storage so the next attempt uses a new one', async () => {
  const hook = mount();
  api.POST.mockResolvedValueOnce(answer({ code: 'FORBIDDEN', message_ar: 'ممنوع', message_en: 'Forbidden' }, 403));
  await act(async () => {
    await expect(hook.result.current.mutateAsync({ kind: 'new', body: BODY })).rejects.toMatchObject({
      status: 403,
    });
  });
  const refusedKey = sentKey(0);
  expect(storedRaw()).toBeNull();
  api.POST.mockResolvedValueOnce(answer(CREATED, 201));
  await act(async () => {
    await hook.result.current.mutateAsync({ kind: 'new', body: BODY });
  });
  expect(sentKey(1)).not.toBe(refusedKey);
});

it('a 409 in-progress answer keeps the key so the retry reuses it', async () => {
  const hook = mount();
  api.POST.mockResolvedValueOnce(
    answer({ code: 'IDEMPOTENCY_KEY_IN_PROGRESS', message_ar: 'قيد التنفيذ', message_en: 'In progress' }, 409),
  );
  await act(async () => {
    await expect(hook.result.current.mutateAsync({ kind: 'new', body: BODY })).rejects.toMatchObject({
      status: 409,
    });
  });
  const heldKey = sentKey(0);
  expect(storedRaw()).not.toBeNull();
  api.POST.mockResolvedValueOnce(answer(CREATED, 201));
  await act(async () => {
    await hook.result.current.mutateAsync({ kind: 'retry' });
  });
  expect(sentKey(1)).toBe(heldKey);
  expect(storedRaw()).not.toBeNull();
  const stored = JSON.parse(storedRaw() ?? '{}') as { createdAt?: string };
  expect(stored.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
});

it('a 5xx keeps the key because the request may have committed', async () => {
  const hook = mount();
  api.POST.mockResolvedValueOnce(answer({ code: 'UNEXPECTED', message_ar: 'خطأ', message_en: 'Unexpected' }, 500));
  await act(async () => {
    await expect(hook.result.current.mutateAsync({ kind: 'new', body: BODY })).rejects.toMatchObject({
      status: 500,
    });
  });
  const heldKey = sentKey(0);
  api.POST.mockResolvedValueOnce(answer(CREATED, 201));
  await act(async () => {
    await hook.result.current.mutateAsync({ kind: 'retry' });
  });
  expect(sentKey(1)).toBe(heldKey);
});

it('a stored attempt of another user is ignored and replaced', async () => {
  seedAttempt({ userId: 'another-user' });
  const hook = mount();
  api.POST.mockResolvedValueOnce(answer(CREATED, 201));
  await act(async () => {
    await hook.result.current.mutateAsync({ kind: 'new', body: BODY });
  });
  const stored = JSON.parse(storedRaw() ?? '{}') as { userId?: string; key?: string };
  expect(stored.userId).toBe(USER);
  expect(stored.key).toBe(sentKey(0));
  expect(stored.key).not.toBe('01920000-0000-7000-8000-0000000000f1');
});

it('a stored attempt older than 23 hours is ignored and replaced', async () => {
  const stale = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  seedAttempt({ startedAt: stale });
  const hook = mount();
  api.POST.mockResolvedValueOnce(answer(CREATED, 201));
  await act(async () => {
    await hook.result.current.mutateAsync({ kind: 'new', body: BODY });
  });
  const stored = JSON.parse(storedRaw() ?? '{}') as { userId?: string; key?: string };
  expect(stored.userId).toBe(USER);
  expect(stored.key).toBe(sentKey(0));
  expect(stored.key).not.toBe('01920000-0000-7000-8000-0000000000f1');
});

it('a retry with nothing stored refuses without sending', async () => {
  const hook = mount();
  await act(async () => {
    await expect(hook.result.current.mutateAsync({ kind: 'retry' })).rejects.toThrow('no undecided');
  });
  expect(api.POST).not.toHaveBeenCalled();
});

it('a successful create keeps a created marker while the workspaces read is still empty', async () => {
  const client = createQueryClient();
  client.setQueryData(['me', 'workspaces'], { companies: [], capabilities: { staff_access: false } });
  const hook = mount(client);
  api.POST.mockResolvedValueOnce(answer(CREATED, 201));
  await act(async () => {
    await hook.result.current.mutateAsync({ kind: 'new', body: BODY });
  });
  const query = client.getQueryState(['me', 'workspaces']);
  expect(query?.isInvalidated).toBe(true);
  const stored = JSON.parse(storedRaw() ?? '{}') as { createdAt?: string; key?: string };
  expect(stored.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  expect(stored.key).toBe(sentKey(0));
});

it('a create when the workspaces read already shows a company sends no POST and removes the stored attempt', async () => {
  seedAttempt();
  api.GET.mockResolvedValueOnce({
    data: {
      capabilities: { staff_access: false },
      companies: [
        {
          id: '01920000-0000-7000-8000-0000000000c9',
          name_ar: null,
          name_en: 'Guard Company',
          role_code: 'owner',
          scope: 'COMPANY',
          businesses: [],
        },
      ],
    },
    response: { status: 200, ok: true },
  });
  const hook = mount();
  await act(async () => {
    const result = await hook.result.current.mutateAsync({ kind: 'new', body: BODY });
    expect(result).toBeNull();
  });
  expect(api.POST).not.toHaveBeenCalled();
  expect(storedRaw()).toBeNull();
});

it('a retry when the workspaces read shows a company sends no POST and removes the stored attempt', async () => {
  seedAttempt();
  const client = createQueryClient();
  const hook = mount(client);
  api.GET.mockResolvedValueOnce({
    data: {
      capabilities: { staff_access: false },
      companies: [
        {
          id: '01920000-0000-7000-8000-0000000000c9',
          name_ar: null,
          name_en: 'Guard Company',
          role_code: 'owner',
          scope: 'COMPANY',
          businesses: [],
        },
      ],
    },
    response: { status: 200, ok: true },
  });
  await act(async () => {
    const result = await hook.result.current.mutateAsync({ kind: 'retry' });
    expect(result).toBeNull();
  });
  expect(api.POST).not.toHaveBeenCalled();
  expect(storedRaw()).toBeNull();
});

it('a failing workspaces read refuses the create and keeps the stored attempt', async () => {
  seedAttempt();
  const hook = mount();
  api.GET.mockResolvedValueOnce({
    data: undefined,
    error: { code: 'UNEXPECTED', message_ar: 'خطأ', message_en: 'Unexpected' },
    response: { status: 500, ok: false },
  });
  await act(async () => {
    await expect(hook.result.current.mutateAsync({ kind: 'retry' })).rejects.toMatchObject({
      code: 'UNEXPECTED',
    });
  });
  expect(api.POST).not.toHaveBeenCalled();
  expect(storedRaw()).not.toBeNull();
  const stored = JSON.parse(storedRaw() ?? '{}') as { key?: string };
  expect(stored.key).toBe('01920000-0000-7000-8000-0000000000f1');
});

it('a refused new submit leaves the stored attempt untouched with the same key', async () => {
  seedAttempt();
  const hook = mount();
  await act(async () => {
    await expect(hook.result.current.mutateAsync({ kind: 'new', body: CHANGED_BODY })).rejects.toThrow(
      'undecided',
    );
  });
  expect(api.POST).not.toHaveBeenCalled();
  const stored = JSON.parse(storedRaw() ?? '{}') as { key?: string };
  expect(stored.key).toBe('01920000-0000-7000-8000-0000000000f1');
});
