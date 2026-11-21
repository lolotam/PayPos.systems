import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { t } from '@pospay/i18n';
import { DirectionProvider } from '@pospay/ui';
import { afterEach, expect, it, vi } from 'vitest';

import { QueryClientProvider } from '@tanstack/react-query';
import { createQueryClient } from '@/shared/api/query-client';
import * as clientModule from '@/shared/api/client';
import { clearSelection } from '@/shared/api/selection-cookie';
import { LocaleProvider } from '@/shared/locale/locale-context';
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
afterEach(() => {
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
  .replace('{{document_number}}', 'SYN-BELL-0001');
const numbersPath = (path: string) => path.includes('employee-document-numbers');

it('DN-22 makes no number request while the panel is closed, then shows the number when the lookup returns it', async () => {
  vi.spyOn(clientModule, 'apiClient').mockImplementation(clientModule.createApiClient);
  const numbersFetch = vi.fn();
  const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const request = input as Request;
    const path = new URL(request.url).pathname;
    if (numbersPath(path)) {
      numbersFetch(path);
      expect(request.signal.aborted).toBe(false);
      return response({ items: [{ document_id: documentId, document_number: 'SYN-BELL-0001' }] });
    }
    if (path.endsWith('/unread-count')) return response({ count: 1 });
    return response({ items: [documentItem()], next_cursor: null });
  });
  renderBell();
  expect(numbersFetch).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: t('en', 'inApp.title') }));
  expect(await screen.findByText(numberedText)).not.toBeNull();
  expect(screen.queryByText(new RegExp(documentId))).toBeNull();
  expect(fetchSpy.mock.calls.length).toBeGreaterThan(0);
  void todayText;
});

it('DN-22 falls back to today’s text when the lookup finds nothing for the id', async () => {
  vi.spyOn(clientModule, 'apiClient').mockImplementation(clientModule.createApiClient);
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const path = new URL((input as Request).url).pathname;
    if (numbersPath(path)) return response({ items: [] });
    if (path.endsWith('/unread-count')) return response({ count: 1 });
    return response({ items: [documentItem()], next_cursor: null });
  });
  renderBell();
  fireEvent.click(screen.getByRole('button', { name: t('en', 'inApp.title') }));
  expect(await screen.findByText(todayText)).not.toBeNull();
});

it('DN-22 falls back to today’s text when the lookup fails, and clears values after close', async () => {
  vi.spyOn(clientModule, 'apiClient').mockImplementation(clientModule.createApiClient);
  let fail = true;
  const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const path = new URL((input as Request).url).pathname;
    if (numbersPath(path)) {
      if (fail) return new Response('{"code":"FORBIDDEN"}', { status: 404 });
      return response({ items: [{ document_id: documentId, document_number: 'SYN-BELL-0002' }] });
    }
    if (path.endsWith('/unread-count')) return response({ count: 1 });
    return response({ items: [documentItem()], next_cursor: null });
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
  vi.spyOn(clientModule, 'apiClient').mockImplementation(clientModule.createApiClient);
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
    if (path.endsWith('/unread-count')) return response({ count: 1 });
    return response({ items: [documentItem()], next_cursor: null });
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

it('clears the previous number when changing business inside the same company', async () => {
  vi.spyOn(clientModule, 'apiClient').mockImplementation(clientModule.createApiClient);
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
    if (path.endsWith('/unread-count')) return response({ count: 1 });
    return response({ items: [documentItem()], next_cursor: null });
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
