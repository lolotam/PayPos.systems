import { t } from '@pospay/i18n';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';

import { EmployeeImportPanel } from './employee-import-panel';

const state = vi.hoisted(() => ({
  template: {
    isPending: false,
    isError: false,
    data: { file_name: 'employees.xlsx', content_base64: 'UEsD' },
  },
  preview: {
    isPending: false,
    isError: false,
    isSuccess: false,
    error: null as unknown,
    data: undefined as Record<string, unknown> | undefined,
    mutate: vi.fn(),
  },
  commit: {
    isPending: false,
    isError: false,
    isSuccess: false,
    error: null as unknown,
    data: undefined as Record<string, unknown> | undefined,
    mutate: vi.fn(),
  },
  status: {
    timedOut: false,
    isError: false,
    error: null as unknown,
    data: undefined as Record<string, unknown> | undefined,
  },
}));

vi.mock('@/shared/locale/locale-context', () => ({ useLocale: () => 'en' }));
vi.mock('../api/use-employee-import', () => ({ useEmployeeImport: () => state }));

const panel = () => <EmployeeImportPanel companyId="company" businessId="business" userId="user" />;
const commitButton = () =>
  screen.getByRole('button', { name: t('en', 'employeeImport.commit') }) as HTMLButtonElement;

beforeEach(() => {
  state.preview.isSuccess = false;
  state.preview.data = undefined;
  state.commit.isSuccess = false;
  state.commit.data = undefined;
  state.status.data = undefined;
  state.status.timedOut = false;
  state.preview.mutate.mockClear();
  state.commit.mutate.mockClear();
});

it('enables commit only once the preview is clean', () => {
  state.preview.isSuccess = true;
  state.preview.data = { preview_id: 'p', row_count: 2, error_count: 1, errors: [] };
  const { rerender } = render(panel());
  expect(commitButton().disabled).toBe(true);
  state.preview.data = { ...state.preview.data, error_count: 0 };
  rerender(panel());
  expect(commitButton().disabled).toBe(false);
});

it('shows the created count after a successful commit', () => {
  state.commit.isSuccess = true;
  state.commit.data = { preview_id: 'p' };
  state.status.data = { status: 'committed', created_count: 3 };
  render(panel());
  expect(screen.getByRole('status').textContent).toContain('3');
});

it('shows a bilingual delayed state when automatic polling reaches its deadline', () => {
  state.status.timedOut = true;
  state.status.data = { status: 'commit_requested' };
  render(panel());
  expect(screen.getByRole('status').textContent).toBe(t('en', 'employeeImport.delayed'));
  expect(t('ar', 'employeeImport.delayed')).not.toBe(t('en', 'employeeImport.delayed'));
});

it('shows pending until the worker reports a terminal result and disables duplicate submission', () => {
  state.preview.isSuccess = true;
  state.preview.data = { preview_id: 'p', error_count: 0, errors: [] };
  state.commit.isSuccess = true;
  state.commit.data = { preview_id: 'p' };
  state.status.data = { status: 'commit_requested' };
  const { rerender } = render(panel());
  expect(screen.getByRole('status').textContent).toBe(t('en', 'employeeImport.pending'));
  expect(commitButton().disabled).toBe(true);
  state.status.data = { status: 'failed', error_code: 'IMPORT_COMMIT_FAILED' };
  rerender(panel());
  expect(screen.getByRole('alert').textContent).toContain(t('en', 'employeeImport.failed'));
  expect(screen.queryByRole('status')).toBeNull();
});

it('previews the chosen file through the hook', () => {
  render(panel());
  const file = new File(['synthetic'], 'employees.xlsx', {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  fireEvent.change(screen.getByLabelText(t('en', 'employeeImport.choose')), {
    target: { files: [file] },
  });
  fireEvent.click(screen.getByRole('button', { name: t('en', 'employeeImport.preview') }));
  expect(state.preview.mutate).toHaveBeenCalledWith(file);
});
