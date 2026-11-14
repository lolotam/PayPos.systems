import type { CustomerPackageExtension } from '@pospay/contracts';
import { formatInstant, t } from '@pospay/i18n';
import { render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { PackageExtensionHistory } from './package-extension-history';

vi.mock('@/shared/locale/locale-context', () => ({ useLocale: () => 'en' }));

const rows: CustomerPackageExtension[] = [
  {
    id: '01920000-0000-7000-8000-000000000002',
    previous_expires_on: '2027-01-31',
    new_expires_on: '2027-02-28',
    extended_at: '2026-10-17T21:30:00.000Z',
    reason: 'Synthetic extension reason',
  },
  {
    id: '01920000-0000-7000-8000-000000000001',
    previous_expires_on: '2026-12-30',
    new_expires_on: '2027-01-31',
    extended_at: '2026-10-16T10:00:00.000Z',
  },
];

it('shows dated rows newest first with branch-local time and reason when present, without money text', () => {
  render(<PackageExtensionHistory extensions={rows} timeZone="Asia/Kuwait" />);
  const items = screen.getAllByRole('listitem');
  expect(items).toHaveLength(2);
  expect(items[0]?.textContent).toContain('From 2027-01-31 to 2027-02-28');
  expect(items[1]?.textContent).toContain('From 2026-12-30 to 2027-01-31');
  const local = formatInstant(new Date('2026-10-17T21:30:00.000Z'), 'en', 'Asia/Kuwait');
  expect(local).toContain('Oct 18, 2026');
  expect(local).toContain('12:30:00 AM');
  expect(items[0]?.textContent).toContain(`Extended at ${local}`);
  expect(screen.getByText(local).getAttribute('dir')).toBe('ltr');
  for (const row of rows) {
    expect(screen.queryByText(row.extended_at)).toBeNull();
    for (const value of [row.previous_expires_on, row.new_expires_on]) {
      expect(screen.getAllByText(value).every((element) => element.getAttribute('dir') === 'ltr'))
        .toBe(true);
    }
  }
  expect(items[0]?.textContent).toContain('Reason: Synthetic extension reason');
  const reason = screen.getByText('Synthetic extension reason');
  expect(reason.tagName.toLowerCase()).toBe('bdi');
  expect(reason.getAttribute('dir')).toBe('auto');
  expect(items[1]?.textContent).not.toContain('Reason:');
  expect(screen.queryByText(/KWD|\b\d+\.\d{3}\b/)).toBeNull();
});

it('shows the empty extension history state', () => {
  render(<PackageExtensionHistory extensions={[]} timeZone="Asia/Kuwait" />);
  expect(screen.getByRole('status').textContent)
    .toBe(t('en', 'packageExtension.historyEmpty'));
  expect(screen.queryByRole('listitem')).toBeNull();
});

it('omits extension timestamps and raw ISO strings when the timezone is absent', () => {
  render(<PackageExtensionHistory extensions={rows} timeZone={undefined} />);
  expect(screen.getAllByRole('listitem')).toHaveLength(2);
  expect(screen.queryByText(/Extended at/)).toBeNull();
  for (const row of rows) expect(screen.queryByText(row.extended_at)).toBeNull();
});
