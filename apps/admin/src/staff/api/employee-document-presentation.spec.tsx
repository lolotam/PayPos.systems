import { t } from '@pospay/i18n';
import { notifyManager, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { useEmployeeDocuments } from './use-employee-documents';

const api = vi.hoisted(() => ({ GET: vi.fn(), POST: vi.fn() }));
vi.mock('@/shared/api/client', () => ({ apiClient: () => api }));
vi.mock('@/shared/locale/locale-context', () => ({ useLocale: () => 'en' }));
const id = '01920000-0000-7000-8000-0000000000a2';
const prefix = ['employee-documents', id, id, id, id];
const storageKey = 'company/business/key/verified';
const view = {
  today: '2026-10-05',
  items: [
    {
      id,
      employee_id: id,
      type_code: 'civil_id',
      type_name_en: 'Civil ID',
      type_name_ar: null,
      object_key: storageKey,
      expires_on: '2026-10-20',
      uploaded_by: id,
      recorded_at: '2026-10-04T08:00:00.000Z',
      status: 'EXPIRING',
    },
  ],
  types: [],
  can_manage: false,
};
const privateDownload = {
  data: { download_url: 'https://storage.test/private', expires_in: 60 },
};
const openButton = () => screen.getByRole('button', { name: t('en', 'employeeDocuments.open') });

afterEach(() => {
  notifyManager.setScheduler((callback) => setTimeout(callback, 0));
  vi.restoreAllMocks();
});

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
function renderOpenProbe() {
  const retained: Array<(storageKey: string) => void> = [];
  function Probe() {
    const documents = useEmployeeDocuments(id, id, id, id);
    retained.push(documents.open.mutate);
    return (
      <>
        <button disabled={documents.open.isPending}>{t('en', 'employeeDocuments.open')}</button>
        {documents.open.isError ? (
          <p role="alert">{t('en', 'employeeDocuments.openRetry')}</p>
        ) : null}
        <p>{documents.view.data?.items[0]?.type_name_en ?? t('en', 'employeeDocuments.empty')}</p>
      </>
    );
  }
  const client = new QueryClient();
  render(
    <QueryClientProvider client={client}>
      <Probe />
    </QueryClientProvider>,
  );
  return { client, retained };
}

it('does not apply a queued revocation paint after a successor opens', async () => {
  api.GET.mockResolvedValue({ data: view });
  const first = deferred<unknown>();
  const second = deferred<unknown>();
  const successor = deferred<unknown>();
  api.POST.mockReturnValueOnce(first.promise)
    .mockReturnValueOnce(second.promise)
    .mockReturnValueOnce(successor.promise);
  const opened = mockWindowOpen();
  const { client, retained } = renderOpenProbe();
  await waitFor(() => expect(retained.length).toBeGreaterThan(1));
  expect(await screen.findByText('Civil ID')).toBeTruthy();
  const current = () => retained.at(-1);
  act(() => current()?.(storageKey));
  await waitFor(() => expect(api.POST).toHaveBeenCalledOnce());
  const queued: Array<() => void> = [];
  notifyManager.setScheduler((callback) => queued.push(callback));
  act(() => client.setQueryData(prefix, { ...view, items: [] }));
  expect(queued.length).toBeGreaterThan(0);
  act(() => current()?.(storageKey));
  await act(async () => {
    for (const notify of queued.splice(0)) notify();
  });
  expect(openButton().hasAttribute('disabled')).toBe(false);
  expect(screen.getByRole('alert').textContent).toBe(t('en', 'employeeDocuments.openRetry'));
  act(() => {
    client.setQueryData(prefix, view);
    current()?.(storageKey);
  });
  await waitFor(() => expect(api.POST).toHaveBeenCalledTimes(2));
  act(() => client.setQueryData(prefix, { ...view, items: [] }));
  expect(queued.length).toBeGreaterThan(0);
  act(() => {
    client.setQueryData(prefix, view);
    current()?.(storageKey);
  });
  await waitFor(() => expect(api.POST).toHaveBeenCalledTimes(3));
  await act(async () => {
    for (const notify of queued.splice(0)) notify();
  });
  expect(openButton().hasAttribute('disabled')).toBe(true);
  expect(screen.queryByRole('alert')).toBeNull();
  expect(screen.getByText('Civil ID')).toBeTruthy();
  expect(opened).toHaveLength(3);
  await settle(first, privateDownload);
  expect(opened[0]?.location.assign).not.toHaveBeenCalled();
  await settle(second, privateDownload);
  expect(opened[1]?.location.assign).not.toHaveBeenCalled();
  expect(openButton().hasAttribute('disabled')).toBe(true);
  expect(screen.queryByRole('alert')).toBeNull();
  await settle(successor, {
    data: { download_url: 'https://storage.test/successor', expires_in: 60 },
  });
  expect(opened[2]?.location.assign).toHaveBeenCalledWith('https://storage.test/successor');
});
