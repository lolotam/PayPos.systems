import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { t } from '@pospay/i18n';
import { DirectionProvider } from '@pospay/ui';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { onlineManager, QueryClientProvider } from '@tanstack/react-query';
import { createQueryClient } from '@/shared/api/query-client';
import * as clientModule from '@/shared/api/client';
import { clearSelection } from '@/shared/api/selection-cookie';
import { LocaleProvider } from '@/shared/locale/locale-context';
import { usePermissions } from '@/permissions/api/use-permissions';
import { NotificationBell } from './notification-bell';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

const companyId = '01920000-0000-7000-8000-0000000000a0';
const documentId = '01920000-0000-7000-8000-0000000000c3';
beforeEach(() => {
  vi.spyOn(clientModule, 'apiClient').mockImplementation(clientModule.createApiClient);
});
afterEach(() => {
  onlineManager.setOnline(true);
  vi.restoreAllMocks();
  clearSelection();
});

function documentItem() {
  return {
    id: '01920000-0000-7000-8000-0000000000c1',
    company_id: companyId,
    business_id: companyId,
    branch_id: null,
    source_event_id: '01920000-0000-7000-8000-0000000000c2',
    template_key: 'document_expiring',
    template_revision: 1,
    locale: 'en' as const,
    safe_parameters: [
      { name: 'employee_name_ar', type: 'text', value: 'Synthetic employee' },
      { name: 'employee_name_en', type: 'text', value: 'Synthetic employee' },
      { name: 'document_type_ar', type: 'text', value: 'passport' },
      { name: 'document_type_en', type: 'text', value: 'passport' },
      { name: 'expires_on', type: 'text', value: '2026-12-01' },
      { name: 'document_id', type: 'text', value: documentId },
    ],
    created_at: '2026-11-01T12:00:00Z',
    read_at: null,
  };
}
function response(data: unknown): Response {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}
function defaultBellResponse(path: string): Response {
  if (path.endsWith('/unread-count')) return response({ count: 1 });
  return response({ items: [documentItem()], next_cursor: null });
}

const userId = '01920000-0000-7000-8000-0000000000f1';
const inboxKey = ['me', 'notifications', companyId, userId, 'list'];

function renderBell() {
  const client = createQueryClient();
  const tree = (businessId = companyId) => (
    <DirectionProvider dir="ltr">
      <LocaleProvider locale="en" setLocale={() => undefined}>
        <QueryClientProvider client={client}>
          <NotificationBell companyId={companyId} userId={userId} businessId={businessId} />
        </QueryClientProvider>
      </LocaleProvider>
    </DirectionProvider>
  );
  const view = render(tree());
  return { client, changeBusiness: (businessId: string) => view.rerender(tree(businessId)) };
}
const todayText = t('en', 'inApp.document_expiring')
  .replace('{{employee_name_en}}', 'Synthetic employee')
  .replace('{{document_type_en}}', 'passport')
  .replace('{{expires_on}}', '2026-12-01');
const numberedText = t('en', 'inApp.document_expiring_numbered')
  .replace('{{employee_name_en}}', 'Synthetic employee')
  .replace('{{document_type_en}}', 'passport')
  .replace('{{expires_on}}', '2026-12-01')
  .replace('{{document_number}}', '\u2068SYN-BELL-0001\u2069');
const numbersPath = (path: string) => path.includes('employee-document-numbers');

it('DN-22 shows numbers only in an open, connected bell with a fresh lookup', async () => {
  const numbersFetch = vi.fn();
  const reconnect = deferred<Response>();
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const request = input as Request;
    const path = new URL(request.url).pathname;
    if (numbersPath(path)) {
      numbersFetch(path);
      expect(request.signal.aborted).toBe(false);
      return numbersFetch.mock.calls.length === 1
        ? response({ items: [{ document_id: documentId, document_number: 'SYN-BELL-0001' }] })
        : reconnect.promise;
    }
    return defaultBellResponse(path);
  });
  renderBell();
  expect(numbersFetch).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: t('en', 'inApp.title') }));
  expect(await screen.findByText(numberedText)).not.toBeNull();
  expect(screen.queryByText(new RegExp(documentId))).toBeNull();
  act(() => onlineManager.setOnline(false));
  expect(await screen.findByText(todayText)).not.toBeNull();
  act(() => onlineManager.setOnline(true));
  expect(screen.queryByText(numberedText)).toBeNull();
  await waitFor(() => expect(numbersFetch).toHaveBeenCalledTimes(2));
  await act(async () =>
    reconnect.resolve(
      response({
        items: [{ document_id: documentId, document_number: 'SYN-BELL-FRESH' }],
      }),
    ),
  );
  expect(
    await screen.findByText(numberedText.replace('SYN-BELL-0001', 'SYN-BELL-FRESH')),
  ).toBeTruthy();
});

it('DN-22 falls back to today’s text when the lookup finds nothing for the id', async () => {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const path = new URL((input as Request).url).pathname;
    if (numbersPath(path)) return response({ items: [] });
    return defaultBellResponse(path);
  });
  renderBell();
  fireEvent.click(screen.getByRole('button', { name: t('en', 'inApp.title') }));
  expect(await screen.findByText(todayText)).not.toBeNull();
});

it('DN-22 falls back to today’s text when the lookup fails, and clears values after close', async () => {
  let fail = true;
  const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const path = new URL((input as Request).url).pathname;
    if (numbersPath(path)) {
      if (fail) return new Response('{"code":"FORBIDDEN"}', { status: 404 });
      return response({ items: [{ document_id: documentId, document_number: 'SYN-BELL-0002' }] });
    }
    return defaultBellResponse(path);
  });
  renderBell();
  fireEvent.click(screen.getByRole('button', { name: t('en', 'inApp.title') }));
  expect(await screen.findByText(todayText)).not.toBeNull();
  fireEvent.keyDown(screen.getByRole('button', { name: t('en', 'inApp.title') }), {
    key: 'Escape',
  });
  expect(screen.queryByRole('region')).toBeNull();
  fail = false;
  fireEvent.click(screen.getByRole('button', { name: t('en', 'inApp.title') }));
  expect(
    await screen.findByText(numberedText.replace('SYN-BELL-0001', 'SYN-BELL-0002')),
  ).not.toBeNull();
  expect(
    fetchSpy.mock.calls.filter(([input]) => numbersPath(new URL((input as Request).url).pathname))
      .length,
  ).toBe(2);
});

it('hides the last number during a same-id inbox refresh and retains the ordinary text after refusal', async () => {
  const request = deferred<Response>();
  const lookup = vi
    .fn()
    .mockResolvedValueOnce(
      response({ items: [{ document_id: documentId, document_number: 'SYN-BELL-0001' }] }),
    )
    .mockReturnValue(request.promise);
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const path = new URL((input as Request).url).pathname;
    if (numbersPath(path)) return lookup();
    return defaultBellResponse(path);
  });
  const { client } = renderBell();
  fireEvent.click(screen.getByRole('button', { name: t('en', 'inApp.title') }));
  await screen.findByText(numberedText);
  void client.invalidateQueries({ queryKey: inboxKey, exact: true });
  await waitFor(() => expect(lookup).toHaveBeenCalledTimes(2));
  expect(screen.queryByText(numberedText)).toBeNull();
  expect(screen.getByText(todayText)).toBeTruthy();
  await act(async () => request.resolve(new Response('{"code":"FORBIDDEN"}', { status: 404 })));
  await waitFor(() => expect(client.isFetching({ queryKey: ['me', 'document-numbers'] })).toBe(0));
  expect(screen.queryByText(numberedText)).toBeNull();
  expect(screen.getByText(todayText)).toBeTruthy();
});

it('revalidates the number when the app learns a document changed while the bell is open', async () => {
  const request = deferred<Response>();
  const lookup = vi
    .fn()
    .mockResolvedValueOnce(
      response({ items: [{ document_id: documentId, document_number: 'SYN-BELL-0001' }] }),
    )
    .mockReturnValue(request.promise);
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const path = new URL((input as Request).url).pathname;
    if (numbersPath(path)) return lookup();
    return defaultBellResponse(path);
  });
  const { client } = renderBell();
  fireEvent.click(screen.getByRole('button', { name: t('en', 'inApp.title') }));
  await screen.findByText(numberedText);
  await act(async () => {
    void client.resetQueries({ queryKey: ['me', 'document-numbers'] });
  });
  await waitFor(() => expect(lookup).toHaveBeenCalledTimes(2));
  expect(screen.queryByText(numberedText)).toBeNull();
  expect(screen.getByText(todayText)).toBeTruthy();
  await act(async () => request.resolve(new Response('{"code":"FORBIDDEN"}', { status: 404 })));
  expect(screen.getByText(todayText)).toBeTruthy();
});

it('discards the first lookup in flight when a permission override changes', async () => {
  const stale = deferred<Response>();
  const lookup = vi
    .fn<(request: Request) => Promise<Response>>()
    .mockReturnValueOnce(stale.promise)
    .mockResolvedValue(new Response('{"code":"NOT_FOUND"}', { status: 404 }));
  const override = {
    permission_code: 'read:files:business',
    effect: 'DENY' as const,
    scope_type: 'BUSINESS' as const,
    scope_id: companyId,
    reason: 'Synthetic reason',
    expires_at: null,
  };
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const request = input as Request;
    const path = new URL(request.url).pathname;
    if (numbersPath(path)) return lookup(request);
    if (path.endsWith('/unread-count')) return response({ count: 1 });
    if (path.endsWith('/overrides') && request.method === 'POST') {
      return response({
        ...override,
        id: userId,
        granted_by: userId,
        granted_at: '2026-11-01T12:00:00Z',
      });
    }
    return response({ items: [documentItem()], next_cursor: null });
  });
  const { client } = renderBell();
  const permissions = renderHook(() => usePermissions(companyId, userId, userId), {
    wrapper: ({ children }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    ),
  });
  fireEvent.click(screen.getByRole('button', { name: t('en', 'inApp.title') }));
  await waitFor(() => expect(lookup).toHaveBeenCalledTimes(1));
  await act(async () => {
    await permissions.result.current.save.mutateAsync(override);
  });
  await waitFor(() => expect(lookup).toHaveBeenCalledTimes(2));
  expect(lookup.mock.calls[0]?.[0].signal.aborted).toBe(true);
  await act(async () => {
    stale.resolve(
      response({ items: [{ document_id: documentId, document_number: 'SYN-BELL-0001' }] }),
    );
  });
  expect(screen.queryByText(numberedText)).toBeNull();
  expect(screen.getByText(todayText)).toBeTruthy();
});

it('clears the previous number when changing business inside the same company', async () => {
  const request = deferred<Response>();
  const lookup = vi
    .fn()
    .mockResolvedValueOnce(
      response({ items: [{ document_id: documentId, document_number: 'SYN-BELL-0001' }] }),
    )
    .mockReturnValue(request.promise);
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const path = new URL((input as Request).url).pathname;
    if (numbersPath(path)) return lookup();
    return defaultBellResponse(path);
  });
  const { client, changeBusiness } = renderBell();
  fireEvent.click(screen.getByRole('button', { name: t('en', 'inApp.title') }));
  await screen.findByText(numberedText);
  changeBusiness('01920000-0000-7000-8000-0000000000df');
  await waitFor(() => expect(lookup).toHaveBeenCalledTimes(2));
  expect(screen.queryByText(numberedText)).toBeNull();
  expect(screen.getByText(todayText)).toBeTruthy();
  await waitFor(() =>
    expect(
      client.getQueriesData({ queryKey: ['me', 'document-numbers', companyId, userId, companyId] }),
    ).toEqual([]),
  );
  request.resolve(response({ items: [] }));
});

it('shows a number only in the authorized activity even when notifications reuse the document id', async () => {
  const otherBusiness = '01920000-0000-7000-8000-0000000000df';
  const sibling = vi.fn<(signal: AbortSignal) => void>();
  const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const request = input as Request;
    const path = new URL(request.url).pathname;
    if (numbersPath(path)) {
      // رفض نشاط واحد (سحب صلاحية مثلًا) ما بيلغي طلب الأنشطة التانية.
      if (path.includes(otherBusiness))
        return new Response('{"code":"FORBIDDEN"}', { status: 404 });
      sibling(request.signal);
      return response({ items: [{ document_id: documentId, document_number: 'SYN-BELL-0001' }] });
    }
    if (path.endsWith('/unread-count')) return response({ count: 2 });
    return response({
      items: [
        documentItem(),
        {
          ...documentItem(),
          id: '01920000-0000-7000-8000-0000000000c5',
          business_id: otherBusiness,
        },
        { ...documentItem(), id: '01920000-0000-7000-8000-0000000000c6', business_id: null },
      ],
      next_cursor: null,
    });
  });
  renderBell();
  fireEvent.click(screen.getByRole('button', { name: t('en', 'inApp.title') }));
  expect(await screen.findByText(numberedText)).not.toBeNull();
  expect(sibling).toHaveBeenCalledTimes(1);
  expect(screen.getAllByText(numberedText)).toHaveLength(1);
  expect(screen.getAllByText(todayText)).toHaveLength(2);
  expect(numbersFetchCount(fetchSpy)).toBe(2);
});

it('a late reply for a removed scope never surfaces after the id set changes', async () => {
  const otherDoc = '01920000-0000-7000-8000-0000000000c9';
  const late = deferred<Response>();
  const changed = deferred<Response>();
  const lookup = vi
    .fn()
    .mockImplementationOnce(() => late.promise)
    .mockImplementationOnce(() => changed.promise);
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const path = new URL((input as Request).url).pathname;
    if (numbersPath(path)) return lookup();
    return defaultBellResponse(path);
  });
  const { client } = renderBell();
  fireEvent.click(screen.getByRole('button', { name: t('en', 'inApp.title') }));
  await waitFor(() => expect(lookup).toHaveBeenCalledTimes(1));
  await act(async () => {
    client.setQueryData(inboxKey, {
      items: [
        {
          ...documentItem(),
          id: '01920000-0000-7000-8000-0000000000c5',
          safe_parameters: documentItem().safe_parameters.map((parameter) =>
            parameter.name === 'document_id' ? { ...parameter, value: otherDoc } : parameter,
          ),
        },
      ],
      next_cursor: null,
    });
  });
  await waitFor(() => expect(lookup).toHaveBeenCalledTimes(2));
  await act(async () => {
    late.resolve(
      response({ items: [{ document_id: documentId, document_number: 'SYN-LATE-0001' }] }),
    );
    changed.resolve(
      response({
        items: [{ document_id: otherDoc, document_number: 'SYN-LATE-0002' }],
      }),
    );
  });
  expect(await screen.findByText(/SYN-LATE-0002/)).not.toBeNull();
  expect(screen.queryByText(/SYN-LATE-0001/)).toBeNull();
});

it('normalizes document id case when reading the numbers map', async () => {
  const upperId = documentId.toUpperCase();
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const path = new URL((input as Request).url).pathname;
    if (numbersPath(path)) {
      return response({
        items: [{ document_id: upperId.toLowerCase(), document_number: 'SYN-BELL-0003' }],
      });
    }
    if (path.endsWith('/unread-count')) return response({ count: 1 });
    return response({
      items: [
        {
          ...documentItem(),
          safe_parameters: documentItem().safe_parameters.map((parameter) =>
            parameter.name === 'document_id' ? { ...parameter, value: upperId } : parameter,
          ),
        },
      ],
      next_cursor: null,
    });
  });
  renderBell();
  fireEvent.click(screen.getByRole('button', { name: t('en', 'inApp.title') }));
  expect(
    await screen.findByText(numberedText.replace('SYN-BELL-0001', 'SYN-BELL-0003')),
  ).not.toBeNull();
});

function numbersFetchCount(fetchSpy: { mock: { calls: unknown[][] } }) {
  return fetchSpy.mock.calls.filter(([input]) =>
    numbersPath(new URL((input as Request).url).pathname),
  ).length;
}
