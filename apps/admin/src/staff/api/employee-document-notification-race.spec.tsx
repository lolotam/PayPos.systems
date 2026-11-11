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

it.each([403, 404])('regression: denial before observer render (%i)', async (status) => {
  let resolveDownload!: (value: unknown) => void;
  const download = new Promise((resolve) => {
    resolveDownload = resolve;
  });
  api.GET.mockResolvedValue({ data: view });
  api.POST.mockReset().mockReturnValue(download);
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
  const reads = api.GET.mock.calls.length;
  const notifications: (() => void)[] = [];
  notifyManager.setScheduler((callback) => notifications.push(callback));
  api.GET.mockResolvedValue({
    error: { code: 'FORBIDDEN', message_en: 'Denied', message_ar: t('ar', 'errors.FORBIDDEN') },
    response: { status },
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
  await drainNotifications(notifications);
  expect((await screen.findByRole('alert')).textContent).toBe('Denied');
  expect(screen.queryByText('Synthetic paper')).toBeNull();
  expect(api.GET).toHaveBeenCalledTimes(reads + 1);
  expect(client.getQueryCache().findAll({ queryKey: key })).toEqual([]);
  expect(opened.location.assign).not.toHaveBeenCalled();
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
async function drainNotifications(queue: (() => void)[]) {
  for (let turn = 0; queue.length > 0 && turn < 10; turn += 1) {
    const batch = queue.splice(0);
    await act(async () => {
      for (const notify of batch) notify();
    });
  }
  expect(queue).toHaveLength(0);
}
async function completeRead(client: QueryClient, queue: (() => void)[], afterRebind: boolean) {
  const read = deferred();
  const genuine = vi.fn(() => read.promise);
  let reading!: Promise<unknown>;
  await act(async () => {
    reading = client.query({ queryKey: key, queryFn: genuine, staleTime: 0 });
  });
  if (afterRebind) await drainNotifications(queue);
  let rebound = false;
  await act(async () => {
    read.resolve(view);
    await reading;
    const current = client.getQueryCache().find({ queryKey: key, exact: true });
    rebound = (current?.getObserversCount() ?? 0) > 0;
  });
  expect(rebound).toBe(afterRebind);
  expect(genuine).toHaveBeenCalledOnce();
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

it.each(['before', 'after'] as const)('%s-rebind read keeps old open invalid', async (order) => {
  const download = deferred();
  api.GET.mockResolvedValue({ data: view });
  api.POST.mockReset();
  api.POST.mockReturnValueOnce(download.promise).mockResolvedValueOnce({
    data: { download_url: 'https://storage.test/recreated', expires_in: 60 },
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
  const old = client.getQueryCache().find({ queryKey: key, exact: true });
  const notifications: (() => void)[] = [];
  notifyManager.setScheduler((callback) => notifications.push(callback));
  const observerRead = deferred();
  const readsBefore = api.GET.mock.calls.length;
  api.GET.mockReturnValue(observerRead.promise);
  act(() => {
    client.removeQueries({ queryKey: key });
    client.setQueryData(key, view);
  });
  const installed = client.getQueryCache().find({ queryKey: key, exact: true });
  expect(old).toBeDefined();
  expect(installed).toBeDefined();
  expect(installed).not.toBe(old);
  expect(pending.close).toHaveBeenCalledOnce();
  await act(async () =>
    download.resolve({ data: { download_url: 'https://storage.test/stale', expires_in: 60 } }),
  );
  expect(pending.location.assign).not.toHaveBeenCalled();
  try {
    await completeRead(client, notifications, order === 'after');
    expect(client.getQueryCache().find({ queryKey: key, exact: true })).toBe(installed);
    expect(api.GET.mock.calls.length - readsBefore).toBe(0);
    await drainNotifications(notifications);
    expect(await screen.findByText('Synthetic paper')).toBeTruthy();
    const button = await screen.findByRole('button', {
      name: t('en', 'employeeDocuments.open'),
      hidden: false,
    });
    expect(getComputedStyle(button).visibility).toBe('visible');
    expect(button.hasAttribute('disabled')).toBe(false);
    fireEvent.click(button);
    await waitFor(() => expect(api.POST).toHaveBeenCalledTimes(2));
    await waitFor(() =>
      expect(successor.location.assign).toHaveBeenCalledWith('https://storage.test/recreated'),
    );
    expect(pending.location.assign).not.toHaveBeenCalled();
  } finally {
    await act(async () => observerRead.resolve({ data: view }));
  }
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

type Documents = ReturnType<typeof useEmployeeDocuments>;
function ReadinessProbe({
  employee = id,
  retain,
}: {
  employee?: string;
  retain: (value: Documents) => void;
}) {
  const result = useEmployeeDocuments(id, id, id, employee);
  retain(result);
  return <p>{result.documents?.items[0]?.type_name_en ?? 'Blocked'}</p>;
}
it('keeps query identity, current observer data and queued lifetime notifications separate', async () => {
  api.GET.mockReset().mockResolvedValue({ data: view });
  const client = new QueryClient();
  let current!: Documents;
  const retain = (value: Documents) => {
    current = value;
  };
  const tree = (employee = id) => (
    <QueryClientProvider client={client}>
      <ReadinessProbe employee={employee} retain={retain} />
    </QueryClientProvider>
  );
  const mounted = render(tree());
  await screen.findByText('Synthetic paper');
  const first = current;
  const data = client.getQueryData(key);
  const original = client.getQueryCache().find({ queryKey: key, exact: true });
  expect(first.documents).toBe(data);
  const read = deferred();
  api.GET.mockReturnValue(read.promise);
  act(() => {
    client.removeQueries({ queryKey: key });
    client.setQueryData(key, data);
  });
  expect(client.getQueryData(key)).toBe(data);
  expect(client.getQueryCache().find({ queryKey: key, exact: true })).not.toBe(original);
  expect(first.documents).toBeUndefined();
  await screen.findByText('Blocked');
  await act(async () => read.resolve({ data: view }));
  await screen.findByText('Synthetic paper');
  const second = current;
  const queue: (() => void)[] = [];
  notifyManager.setScheduler((callback) => queue.push(callback));
  act(() =>
    client.setQueryData(key, {
      ...view,
      items: view.items.map((item) => ({ ...item, type_name_en: 'Changed' })),
    }),
  );
  expect(second.documents).toBeUndefined();
  await drainNotifications(queue);
  expect(screen.getByText('Changed')).toBeTruthy();
  expect(current.documents).toBe(client.getQueryData(key));
  const employee = '01920000-0000-7000-8000-0000000000b2';
  api.GET.mockReturnValue(deferred().promise);
  act(() => {
    client.setQueryData([...key.slice(0, -1), employee], client.getQueryData(key));
    client.setQueryData(key, view);
  });
  expect(queue.length).toBeGreaterThan(0);
  mounted.rerender(tree(employee));
  await drainNotifications(queue);
  expect(current.documents).toBeUndefined();
  expect(second.documents).toBeUndefined();
  expect(screen.getByText('Blocked')).toBeTruthy();
});

it.each([403, 404])(
  'recovers a denied %i read on reconnect without reviving its held open',
  async (status) => {
    api.GET.mockReset().mockResolvedValue({ data: view });
    const download = deferred();
    api.POST.mockReset()
      .mockReturnValueOnce(download.promise)
      .mockResolvedValueOnce({
        data: { download_url: 'https://storage.test/successor', expires_in: 60 },
      });
    const original = popup();
    const successor = popup();
    vi.spyOn(window, 'open')
      .mockReturnValueOnce(original as unknown as Window)
      .mockReturnValueOnce(successor as unknown as Window);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    renderDocuments(client);
    fireEvent.click(await screen.findByRole('button', { name: t('en', 'employeeDocuments.open') }));
    await waitFor(() => expect(api.POST).toHaveBeenCalledOnce());
    api.GET.mockResolvedValue({
      error: { code: 'FORBIDDEN', message_en: 'Denied', message_ar: t('ar', 'errors.FORBIDDEN') },
      response: { status },
    });
    fireEvent(window, new Event('offline'));
    fireEvent(window, new Event('online'));
    expect((await screen.findByRole('alert')).textContent).toBe('Denied');
    expect(original.closed).toBe(true);
    expect(screen.queryByText('Synthetic paper')).toBeNull();
    expect(client.getQueryCache().findAll({ queryKey: key })).toEqual([]);
    api.GET.mockResolvedValue({ data: view });
    fireEvent(window, new Event('offline'));
    fireEvent(window, new Event('online'));
    await screen.findByRole('button', { name: t('en', 'employeeDocuments.open') });
    expect(api.GET).toHaveBeenCalledTimes(3);
    await act(async () =>
      download.resolve({ data: { download_url: 'https://storage.test/stale', expires_in: 60 } }),
    );
    expect(original.location.assign).not.toHaveBeenCalled();
    fireEvent.click(await screen.findByRole('button', { name: t('en', 'employeeDocuments.open') }));
    await waitFor(() =>
      expect(successor.location.assign).toHaveBeenCalledWith('https://storage.test/successor'),
    );
  },
);
