import { t } from '@pospay/i18n';
import { render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { EmployeeImportErrors } from './employee-import-errors';

const state = vi.hoisted(() => ({ locale: 'en' as 'ar' | 'en' }));
vi.mock('@/shared/locale/locale-context', () => ({ useLocale: () => state.locale }));

const preview = (errorCount: number) => ({
  preview_id: '01920000-0000-7000-8000-0000000000a2',
  row_count: 1,
  error_count: errorCount,
  errors:
    errorCount === 0
      ? []
      : [
          {
            row: 3,
            column: 'primary_branch' as const,
            code: 'IMPORT_BRANCH_NOT_FOUND' as const,
          },
        ],
});

it.each(['ar', 'en'] as const)('shows the clean state in %s when there are no errors', (locale) => {
  state.locale = locale;
  render(<EmployeeImportErrors preview={preview(0)} />);
  expect(screen.getByRole('status').textContent).toBe(t(locale, 'employeeImport.clean'));
});

it('renders a per-row bilingual reason', () => {
  state.locale = 'en';
  render(<EmployeeImportErrors preview={preview(1)} />);
  expect(screen.getByRole('table')).toBeTruthy();
  expect(screen.getByText('3')).toBeTruthy();
  expect(screen.getByText(t('en', 'employeeImport.code_IMPORT_BRANCH_NOT_FOUND'))).toBeTruthy();
  expect(screen.getByText(t('en', 'employeeImport.column_primary_branch'))).toBeTruthy();
});
