import { t } from '@pospay/i18n';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { EmployeeImportPanel } from './employee-import-panel';

const api = vi.hoisted(() => ({ GET: vi.fn(), POST: vi.fn() }));
vi.mock('@/shared/api/client', () => ({ apiClient: () => api }));
vi.mock('@/shared/locale/locale-context', () => ({ useLocale: () => 'en' }));
vi.mock('../api/upload-import-file', () => ({ uploadImportFile: async () => 'file-id' }));
const firstId = '01920000-0000-7000-8000-0000000000e1';
const secondId = '01920000-0000-7000-8000-0000000000e2';
const clean = (id: string) => ({
  data: { preview_id: id, row_count: 1, error_count: 0, errors: [] },
});
const button = (key: 'commit' | 'preview') =>
  screen.getByRole('button', {
    name: t('en', `employeeImport.${key}`),
  }) as HTMLButtonElement;

function select(name: string) {
  fireEvent.change(screen.getByLabelText(t('en', 'employeeImport.choose')), {
    target: { files: [new File(['synthetic'], name)] },
  });
}

beforeEach(() => {
  sessionStorage.clear();
  api.POST.mockReset();
  api.GET.mockResolvedValue({
    data: {
      file_name: 'employees.xlsx',
      content_type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      content_base64: 'UEsD',
    },
  });
  render(
    <QueryClientProvider client={new QueryClient()}>
      <EmployeeImportPanel companyId="company" businessId="business" userId="user" />
    </QueryClientProvider>,
  );
});

it('clears file A preview and result immediately when selecting file B', async () => {
  api.POST.mockResolvedValue(clean(firstId));
  select('A.xlsx');
  fireEvent.click(button('preview'));
  await waitFor(() => expect(button('commit').disabled).toBe(false));
  expect(screen.getByText(t('en', 'employeeImport.clean'))).toBeTruthy();
  select('B.xlsx');
  expect(button('commit').disabled).toBe(true);
  expect(screen.queryByText(t('en', 'employeeImport.clean'))).toBeNull();
  expect(screen.queryByRole('status')).toBeNull();
  fireEvent.click(button('commit'));
  expect(api.POST).toHaveBeenCalledTimes(1);
});

it('discards a late preview for superseded file A and commits only file B preview', async () => {
  let resolve!: (result: ReturnType<typeof clean>) => void;
  api.POST.mockReturnValueOnce(
    new Promise<ReturnType<typeof clean>>((done) => {
      resolve = done;
    }),
  );
  select('A.xlsx');
  fireEvent.click(button('preview'));
  await waitFor(() => expect(api.POST).toHaveBeenCalledTimes(1));
  select('B.xlsx');
  await act(async () => resolve(clean(firstId)));
  await waitFor(() => expect(button('preview').disabled).toBe(false));
  expect(button('commit').disabled).toBe(true);
  expect(screen.queryByText(t('en', 'employeeImport.clean'))).toBeNull();
  api.POST.mockResolvedValueOnce(clean(secondId)).mockResolvedValueOnce({
    data: { preview_id: secondId },
  });
  fireEvent.click(button('preview'));
  await waitFor(() => expect(button('commit').disabled).toBe(false));
  fireEvent.click(button('commit'));
  await waitFor(() => expect(api.POST).toHaveBeenCalledTimes(3));
  expect(api.POST.mock.calls[2]?.[1].body).toEqual({ preview_id: secondId });
});
