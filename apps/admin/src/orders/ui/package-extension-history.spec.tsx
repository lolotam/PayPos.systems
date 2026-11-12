import type { CustomerPackageExtension } from '@pospay/contracts';
import { t } from '@pospay/i18n';
import { render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { PackageExtensionHistory } from './package-extension-history';

vi.mock('@/shared/locale/locale-context', () => ({ useLocale: () => 'en' }));

const rows: CustomerPackageExtension[] = [
  {
    id: '01920000-0000-7000-8000-000000000002',
    previous_expires_on: '2027-01-31',
    new_expires_on: '2027-02-28',
    extended_at: '2027-02-01T10:00:00.000Z',
  },
  {
    id: '01920000-0000-7000-8000-000000000001',
    previous_expires_on: '2026-12-30',
    new_expires_on: '2027-01-31',
    extended_at: '2027-01-01T10:00:00.000Z',
  },
];

it('shows dated rows newest first without reason or money text', () => {
  render(<PackageExtensionHistory extensions={rows} />);
  const items = screen.getAllByRole('listitem');
  expect(items).toHaveLength(2);
  expect(items[0]?.textContent).toContain('From 2027-01-31 to 2027-02-28');
  expect(items[1]?.textContent).toContain('From 2026-12-30 to 2027-01-31');
  expect(items[0]?.textContent).toContain('Extended at 2027-02-01T10:00:00.000Z');
  expect(screen.queryByText('Synthetic private reason')).toBeNull();
  expect(screen.queryByText(/KWD|\b\d+\.\d{3}\b/)).toBeNull();
  for (const row of rows) {
    for (const value of [row.previous_expires_on, row.new_expires_on, row.extended_at]) {
      expect(screen.getAllByText(value).every((element) => element.getAttribute('dir') === 'ltr'))
        .toBe(true);
    }
  }
});

it('shows the empty extension history state', () => {
  render(<PackageExtensionHistory extensions={[]} />);
  expect(screen.getByRole('status').textContent)
    .toBe(t('en', 'packageExtension.historyEmpty'));
  expect(screen.queryByRole('listitem')).toBeNull();
});
