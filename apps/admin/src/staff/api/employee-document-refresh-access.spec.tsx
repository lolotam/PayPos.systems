import { t } from '@pospay/i18n';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { EmployeeDocumentsSection } from '../ui/employee-documents-section';

const api = vi.hoisted(() => ({ GET: vi.fn(), POST: vi.fn() }));
vi.mock('@/shared/api/client', () => ({ apiClient: () => api }));
vi.mock('@/shared/locale/locale-context', () => ({ useLocale: () => 'en' }));
afterEach(() => vi.unstubAllGlobals());
const id = '01920000-0000-7000-8000-0000000000a2';
const fileId = '01920000-0000-7000-8000-0000000000f9';
const prefix = ['employee-documents', id, id, id, id];
const document = {
  id,
  employee_id: id,
  type_code: 'civil_id',
  type_name_en: 'Civil ID',
  type_name_ar: null,
  object_key: 'synthetic/verified',
  expires_on: '2026-10-20',
  uploaded_by: id,
  recorded_at: '2026-10-04T08:00:00.000Z',
  status: 'EXPIRING',
};
const view = (canManage: boolean) => ({
  today: '2026-10-05',
  items: [document],
  can_manage: canManage,
  types: [
    {
      id,
      code: 'civil_id',
      name_en: 'Civil ID',
      name_ar: 'Synthetic',
      alert_days: 30,
      requires_expiry: true,
      active: true,
      revision: 1,
    },
  ],
});

it('suppresses a completed upload success after write access is revoked during its refresh', async () => {
  let refreshStarted = false;
  let resolveRefresh!: (value: { data: ReturnType<typeof view> }) => void;
  const refresh = new Promise<{ data: ReturnType<typeof view> }>((resolve) => {
    resolveRefresh = resolve;
  });
  api.GET.mockImplementation(async (path: string) => {
    if (path === '/v1/files/{id}')
      return {
        data: { id: fileId, status: 'READY', content_type: 'application/pdf', size_bytes: 3 },
      };
    return refreshStarted ? refresh : { data: view(true) };
  });
  api.POST.mockImplementation(async (path: string) => {
    if (path === '/v1/businesses/{businessId}/files/uploads')
      return {
        data: {
          id: fileId,
          upload_url: 'https://storage.test/upload',
          expires_in: 120,
          headers: { 'content-type': 'application/pdf', 'content-length': '3' },
        },
      };
    if (path === '/v1/files/{id}/confirm') return { data: { id: fileId, status: 'QUEUED' } };
    refreshStarted = true;
    return { data: document };
  });
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <EmployeeDocumentsSection companyId={id} businessId={id} userId={id} employeeId={id} />
    </QueryClientProvider>,
  );
  fireEvent.change(await screen.findByLabelText(t('en', 'employeeDocuments.file')), {
    target: { files: [new File(['pdf'], 'civil.pdf', { type: 'application/pdf' })] },
  });
  fireEvent.change(screen.getByLabelText(t('en', 'employeeDocuments.expiresOn')), {
    target: { value: '2026-10-20' },
  });
  fireEvent.click(screen.getByRole('button', { name: t('en', 'employeeDocuments.upload') }));
  await waitFor(() => expect(client.isFetching({ queryKey: prefix })).toBe(1));
  await act(async () => resolveRefresh({ data: view(false) }));
  await waitFor(() => expect(client.isMutating()).toBe(0));
  expect(screen.queryByText(t('en', 'employeeDocuments.recorded'))).toBeNull();
  expect(screen.queryByLabelText(t('en', 'employeeDocuments.file'))).toBeNull();
  act(() => client.setQueryData(prefix, view(true)));
  expect(await screen.findByLabelText(t('en', 'employeeDocuments.file'))).toBeTruthy();
  expect(screen.queryByText(t('en', 'employeeDocuments.recorded'))).toBeNull();
});
