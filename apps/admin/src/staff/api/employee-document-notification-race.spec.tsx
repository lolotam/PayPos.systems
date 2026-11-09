import { t } from '@pospay/i18n';
import { notifyManager, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { EmployeeDocumentsSection } from '../ui/employee-documents-section';
import { useEmployeeDocuments } from './use-employee-documents';

const api = vi.hoisted(() => ({ GET: vi.fn(), POST: vi.fn() }));
vi.mock('@/shared/api/client', () => ({ apiClient: () => api }));
vi.mock('@/shared/locale/locale-context', () => ({ useLocale: () => 'en' }));
afterEach(() => {
  notifyManager.setScheduler((callback) => setTimeout(callback, 0));
  vi.restoreAllMocks();
});
const id = '01920000-0000-7000-8000-0000000000a2';
const key = ['employee-documents', id, id, id, id];
function popup() {
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

const view = {
  today: '2026-10-05',
  can_manage: false,
  types: [],
  items: [
    {
      id,
      employee_id: id,
      type_code: 'civil_id',
      type_name_en: 'Synthetic paper',
      type_name_ar: null,
      object_key: 'synthetic/verified',
      expires_on: null,
      uploaded_by: id,
      recorded_at: '2026-10-04T08:00:00.000Z',
      status: 'NO_EXPIRY',
    },
  ],
};

it('regression: refuses a late download before the denial observer render runs', async () => {
  let resolveDownload!: (value: unknown) => void;
  const download = new Promise((resolve) => {
    resolveDownload = resolve;
  });
  api.GET.mockResolvedValue({ data: view });
  api.POST.mockReturnValue(download);
  const opened = popup();
  vi.spyOn(window, 'open').mockReturnValue(opened as unknown as Window);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <EmployeeDocumentsSection companyId={id} businessId={id} userId={id} employeeId={id} />
    </QueryClientProvider>,
  );
  fireEvent.click(await screen.findByRole('button', { name: t('en', 'employeeDocuments.open') }));
  await waitFor(() => expect(api.POST).toHaveBeenCalledOnce());
  const notifications: (() => void)[] = [];
  notifyManager.setScheduler((callback) => notifications.push(callback));
  api.GET.mockResolvedValue({
    error: { code: 'FORBIDDEN', message_en: 'Denied', message_ar: t('ar', 'errors.FORBIDDEN') },
    response: { status: 403 },
  });
  await act(async () => {
    await client.refetchQueries({ queryKey: key });
  });
  expect(notifications.length).toBeGreaterThan(0);
  expect(screen.getByText('Synthetic paper')).toBeTruthy();
  await act(async () =>
    resolveDownload({
      data: { download_url: 'https://storage.test/private', expires_in: 60 },
    }),
  );
  await waitFor(() => expect(client.isMutating()).toBe(0));
  expect(opened.close).toHaveBeenCalledOnce();
  expect(opened.location.assign).not.toHaveBeenCalled();
  await act(async () => {
    for (const notify of notifications.splice(0)) notify();
  });
  expect((await screen.findByRole('alert')).textContent).toBe('Denied');
  expect(screen.queryByText('Synthetic paper')).toBeNull();
});

function deferred() {
  let resolve!: (value: unknown) => void;
  const promise = new Promise((done) => (resolve = done));
  return { promise, resolve };
}
function renderDocuments(client: QueryClient) {
  render(
    <QueryClientProvider client={client}>
      <EmployeeDocumentsSection companyId={id} businessId={id} userId={id} employeeId={id} />
    </QueryClientProvider>,
  );
}

it('permanently invalidates key disappearance before restoration and isolates its successor', async () => {
  const download = deferred();
  api.GET.mockResolvedValue({ data: view });
  api.POST.mockReturnValueOnce(download.promise).mockResolvedValueOnce({
    data: { download_url: 'https://storage.test/successor', expires_in: 60 },
  });
  const pending = popup();
  const successor = popup();
  vi.spyOn(window, 'open')
    .mockReturnValueOnce(pending as unknown as Window)
    .mockReturnValueOnce(successor as unknown as Window);
  const client = new QueryClient();
  renderDocuments(client);
  fireEvent.click(await screen.findByRole('button', { name: t('en', 'employeeDocuments.open') }));
  await waitFor(() => expect(api.POST).toHaveBeenCalledOnce());
  const notifications: (() => void)[] = [];
  notifyManager.setScheduler((callback) => notifications.push(callback));
  act(() => {
    client.setQueryData(key, { ...view, items: [] });
    client.setQueryData(key, view);
  });
  expect(pending.close).toHaveBeenCalledOnce();
  expect(notifications.length).toBeGreaterThan(0);
  await act(async () => {
    for (const notify of notifications.splice(0)) notify();
  });
  expect(screen.getByText('Synthetic paper')).toBeTruthy();
  expect(
    screen
      .getByRole('button', { name: t('en', 'employeeDocuments.open') })
      .hasAttribute('disabled'),
  ).toBe(false);
  fireEvent.click(screen.getByRole('button', { name: t('en', 'employeeDocuments.open') }));
  await act(async () =>
    download.resolve({ data: { download_url: 'https://storage.test/stale', expires_in: 60 } }),
  );
  expect(pending.location.assign).not.toHaveBeenCalled();
  await waitFor(() =>
    expect(successor.location.assign).toHaveBeenCalledWith('https://storage.test/successor'),
  );
  expect(pending.location.assign).not.toHaveBeenCalled();
});

it('does not revive an attempt when its query is removed and recreated', async () => {
  const download = deferred();
  api.GET.mockResolvedValue({ data: view });
  api.POST.mockReturnValueOnce(download.promise).mockResolvedValueOnce({
    data: { download_url: 'https://storage.test/recreated', expires_in: 60 },
  });
  const pending = popup();
  vi.spyOn(window, 'open')
    .mockReturnValueOnce(pending as unknown as Window)
    .mockReturnValueOnce(popup() as unknown as Window);
  const client = new QueryClient();
  renderDocuments(client);
  fireEvent.click(await screen.findByRole('button', { name: t('en', 'employeeDocuments.open') }));
  await waitFor(() => expect(api.POST).toHaveBeenCalledOnce());
  act(() => {
    client.removeQueries({ queryKey: key });
    client.setQueryData(key, view);
  });
  expect(pending.close).toHaveBeenCalledOnce();
  await act(async () =>
    download.resolve({ data: { download_url: 'https://storage.test/stale', expires_in: 60 } }),
  );
  expect(pending.location.assign).not.toHaveBeenCalled();
  const genuine = vi.fn(async () => view);
  await act(async () => {
    await client.query({ queryKey: key, queryFn: genuine, staleTime: 0 });
  });
  expect(genuine).toHaveBeenCalledOnce();
  expect(await screen.findByText('Synthetic paper')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: t('en', 'employeeDocuments.open') }));
  await waitFor(() => expect(api.POST).toHaveBeenCalledTimes(2));
});

it('does not grant fresh read from a removed query or a manual restore', async () => {
  let finish!: (value: { data: typeof view }) => void;
  api.GET.mockReturnValue(new Promise((resolve) => (finish = resolve)));
  const opened = vi.spyOn(window, 'open').mockReturnValue(popup() as unknown as Window);
  const retained: Array<(storageKey: string) => void> = [];
  function Probe() {
    const documents = useEmployeeDocuments(id, id, id, id);
    retained.push(documents.open.mutate);
    return null;
  }
  const client = new QueryClient();
  render(
    <QueryClientProvider client={client}>
      <Probe />
    </QueryClientProvider>,
  );
  await waitFor(() => expect(retained.length).toBeGreaterThan(1));
  const current = () => retained.at(-1);
  act(() => {
    client.setQueryData(key, view);
    current()?.('synthetic/verified');
  });
  expect(opened).not.toHaveBeenCalled();
  expect(api.POST).not.toHaveBeenCalled();
  await act(async () => finish({ data: view }));
  act(() => current()?.('synthetic/verified'));
  await waitFor(() => expect(api.POST).toHaveBeenCalledOnce());
  const afterRead = current();
  act(() => {
    client.removeQueries({ queryKey: key });
    client.setQueryData(key, view);
    afterRead?.('synthetic/verified');
  });
  expect(api.POST).toHaveBeenCalledOnce();
  expect(opened).toHaveBeenCalledOnce();
});
