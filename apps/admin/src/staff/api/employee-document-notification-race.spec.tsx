import { t } from '@pospay/i18n';
import { notifyManager, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { EmployeeDocumentsSection } from '../ui/employee-documents-section';

const api = vi.hoisted(() => ({ GET: vi.fn(), POST: vi.fn() }));
vi.mock('@/shared/api/client', () => ({ apiClient: () => api }));
vi.mock('@/shared/locale/locale-context', () => ({ useLocale: () => 'en' }));
afterEach(() => {
  notifyManager.setScheduler((callback) => setTimeout(callback, 0));
  vi.restoreAllMocks();
});
const id = '01920000-0000-7000-8000-0000000000a2';
const key = ['employee-documents', id, id, id, id];
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
  const opened = vi.spyOn(window, 'open').mockImplementation(() => null);
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
  expect(opened).not.toHaveBeenCalled();
  await act(async () => {
    for (const notify of notifications.splice(0)) notify();
  });
  expect((await screen.findByRole('alert')).textContent).toBe('Denied');
  expect(screen.queryByText('Synthetic paper')).toBeNull();
});
