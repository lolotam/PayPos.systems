import { t } from '@pospay/i18n';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { EmployeeDocumentsSection } from '../ui/employee-documents-section';

const api = vi.hoisted(() => ({ GET: vi.fn(), POST: vi.fn() }));
vi.mock('@/shared/api/client', () => ({ apiClient: () => api }));
vi.mock('@/shared/locale/locale-context', () => ({ useLocale: () => 'en' }));
const id = '01920000-0000-7000-8000-0000000000a2';
const props = { companyId: id, businessId: id, userId: id, employeeId: id };
const recordedDocument = {
  id,
  employee_id: id,
  type_code: 'civil_id',
  type_name_en: 'Civil ID',
  type_name_ar: null,
  object_key: 'company/business/key/verified',
  expires_on: '2026-10-20',
  uploaded_by: id,
  recorded_at: '2026-10-04T08:00:00.000Z',
  status: 'EXPIRING',
};
const view = () => ({
  today: '2026-10-05',
  items: [recordedDocument],
  types: [
    {
      id,
      code: 'civil_id',
      name_en: 'Civil ID',
      name_ar: 'Synthetic civil ID (ar)',
      alert_days: 30,
      requires_expiry: true,
      active: true,
      revision: 1,
    },
  ],
  can_manage: true,
});
const privateDownload = {
  data: { download_url: 'https://storage.test/private', expires_in: 60 },
};
const openButton = () => screen.getByRole('button', { name: t('en', 'employeeDocuments.open') });
beforeEach(() => {
  api.GET.mockReset();
  api.POST.mockReset();
});
afterEach(() => vi.restoreAllMocks());
function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const rendered = render(
    <QueryClientProvider client={client}>
      <EmployeeDocumentsSection {...props} />
    </QueryClientProvider>,
  );
  return { client, ...rendered };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => (resolve = done));
  return { promise, resolve };
}
const settle = <T,>(operation: { resolve: (value: T) => void }, value: T) =>
  act(async () => operation.resolve(value));
function popupHandle() {
  const handle = {
    opener: window as unknown,
    closed: false,
    location: { assign: vi.fn() },
    close: vi.fn(),
  };
  handle.close.mockImplementation(() => {
    handle.closed = true;
  });
  return handle;
}
function mockWindowOpen() {
  const handles: ReturnType<typeof popupHandle>[] = [];
  vi.spyOn(window, 'open').mockImplementation(() => {
    const handle = popupHandle();
    handles.push(handle);
    return handle as unknown as Window;
  });
  return handles;
}
function cachedMutation(client: QueryClient) {
  return client.getMutationCache().getAll()[0];
}

it('acquires an isolated placeholder before one coalesced request and returns no capability', async () => {
  const download = deferred<unknown>();
  api.GET.mockResolvedValue({ data: view() });
  const opened = mockWindowOpen();
  api.POST.mockImplementation(() => {
    expect(opened).toHaveLength(1);
    return download.promise;
  });
  const { client } = setup();
  const button = await screen.findByRole('button', { name: t('en', 'employeeDocuments.open') });
  fireEvent.click(button);
  fireEvent.click(button);
  expect(opened).toHaveLength(1);
  expect(opened[0]?.opener).toBeNull();
  await waitFor(() => expect(api.POST).toHaveBeenCalledOnce());
  expect(openButton().hasAttribute('disabled')).toBe(true);
  await settle(download, privateDownload);
  expect(opened[0]?.location.assign).toHaveBeenCalledWith('https://storage.test/private');
  const mutation = cachedMutation(client);
  expect(mutation?.state.data).toBeUndefined();
  expect(mutation?.state.variables).toEqual({});
});

it.each(['null', 'throw', 'isolation'] as const)(
  'shows a safe retry without POST after %s acquisition failure',
  async (failureKind) => {
    api.GET.mockResolvedValue({ data: view() });
    let acquired: ReturnType<typeof popupHandle> | undefined;
    vi.spyOn(window, 'open').mockImplementation(() => {
      if (failureKind === 'null') return null;
      if (failureKind === 'throw') throw new Error('native details must stay private');
      acquired = popupHandle();
      Object.defineProperty(acquired, 'opener', { get: () => window, set: () => undefined });
      return acquired as unknown as Window;
    });
    setup();
    fireEvent.click(await screen.findByRole('button', { name: t('en', 'employeeDocuments.open') }));
    expect((await screen.findByRole('alert')).textContent).toBe(
      t('en', 'employeeDocuments.openRetry'),
    );
    expect(api.POST).not.toHaveBeenCalled();
    expect(openButton().hasAttribute('disabled')).toBe(false);
    if (acquired) expect(acquired.close).toHaveBeenCalledOnce();
  },
);

it('closes a failed request placeholder and sanitizes the mutation cache', async () => {
  api.GET.mockResolvedValue({ data: view() });
  api.POST.mockRejectedValue({ message_en: 'raw https://storage.test/private', message_ar: 'raw' });
  const opened = mockWindowOpen();
  const { client } = setup();
  fireEvent.click(await screen.findByRole('button', { name: t('en', 'employeeDocuments.open') }));
  expect((await screen.findByRole('alert')).textContent).toBe(
    t('en', 'employeeDocuments.openRetry'),
  );
  expect(opened[0]?.closed).toBe(true);
  const mutation = cachedMutation(client);
  expect(mutation?.state.data).toBeUndefined();
  expect(mutation?.state.variables).toEqual({});
  expect(JSON.stringify(mutation?.state.error)).not.toContain('storage.test');
});

it('cleans an assignment failure without closing an earlier document or caching raw details', async () => {
  api.GET.mockResolvedValue({ data: view() });
  api.POST.mockResolvedValue(privateDownload);
  const successful = popupHandle();
  const failed = popupHandle();
  const retry = popupHandle();
  failed.location.assign.mockImplementation(() => {
    throw new Error('navigation rejected for https://storage.test/private');
  });
  vi.spyOn(window, 'open')
    .mockReturnValueOnce(successful as unknown as Window)
    .mockReturnValueOnce(failed as unknown as Window)
    .mockReturnValueOnce(retry as unknown as Window);
  const { client } = setup();
  fireEvent.click(await screen.findByRole('button', { name: t('en', 'employeeDocuments.open') }));
  await waitFor(() => expect(successful.location.assign).toHaveBeenCalledOnce());
  fireEvent.click(openButton());
  expect((await screen.findByRole('alert')).textContent).toBe(
    t('en', 'employeeDocuments.openRetry'),
  );
  expect(failed.close).toHaveBeenCalledOnce();
  expect(successful.close).not.toHaveBeenCalled();
  const cached = JSON.stringify(
    client
      .getMutationCache()
      .getAll()
      .map((entry) => entry.state.error),
  );
  expect(cached).not.toContain('navigation rejected');
  expect(cached).not.toContain('storage.test');
  fireEvent.click(openButton());
  await waitFor(() => expect(retry.location.assign).toHaveBeenCalledOnce());
  expect(successful.close).not.toHaveBeenCalled();
});

it('replaces a closed blank before the held response settles', async () => {
  const download = deferred<unknown>();
  const next = deferred<unknown>();
  api.GET.mockResolvedValue({ data: view() });
  api.POST.mockReturnValueOnce(download.promise).mockReturnValueOnce(next.promise);
  const opened = mockWindowOpen();
  const { client } = setup();
  fireEvent.click(await screen.findByRole('button', { name: t('en', 'employeeDocuments.open') }));
  await waitFor(() => expect(api.POST).toHaveBeenCalledOnce());
  const firstMutation = client.getMutationCache().getAll().at(-1);
  const first = opened[0];
  act(() => {
    if (first) first.closed = true;
    window.dispatchEvent(new Event('focus'));
  });
  expect(openButton().hasAttribute('disabled')).toBe(false);
  fireEvent.click(openButton());
  await waitFor(() => expect(api.POST).toHaveBeenCalledTimes(2));
  expect(opened).toHaveLength(2);
  await settle(download, privateDownload);
  expect(first?.location.assign).not.toHaveBeenCalled();
  await waitFor(() => expect(firstMutation?.state.status).toBe('error'));
  expect(openButton().hasAttribute('disabled')).toBe(true);
  await settle(next, { data: { download_url: 'https://storage.test/successor', expires_in: 60 } });
  expect(opened[1]?.location.assign).toHaveBeenCalledWith('https://storage.test/successor');
  expect(first?.close).not.toHaveBeenCalled();
});
