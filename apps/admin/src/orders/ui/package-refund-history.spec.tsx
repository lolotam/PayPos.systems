import type { CustomerPackageRefund } from '@pospay/contracts';
import { formatInstant, t } from '@pospay/i18n';
import { render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { PackageRefundHistory } from './package-refund-history';

vi.mock('@/shared/locale/locale-context', () => ({ useLocale: () => 'en' }));

const rows: CustomerPackageRefund[] = [
  {
    id: '01920000-0000-7000-8000-000000000002',
    component_id: '01920000-0000-7000-8000-000000000020',
    sessions: 3,
    amount: '6.750',
    method: 'CARD',
    reason: 'Synthetic refund reason',
    refunded_at: '2026-11-20T09:30:00.000Z',
  },
  {
    id: '01920000-0000-7000-8000-000000000001',
    component_id: '01920000-0000-7000-8000-000000000020',
    sessions: 1,
    amount: '2.250',
    method: 'CASH',
    reason: '',
    refunded_at: '2026-11-19T09:30:00.000Z',
  },
];

it('shows the sessions, the amount, the method and the branch-local time of every refund', () => {
  render(<PackageRefundHistory refunds={rows} timeZone="Asia/Kuwait" />);
  const items = screen.getAllByRole('listitem');
  expect(items).toHaveLength(2);
  expect(items[0]?.textContent).toContain('3 session(s)');
  expect(items[0]?.textContent).toContain('6.750');
  expect(items[0]?.textContent).toContain('Card');
  expect(items[1]?.textContent).toContain('1 session(s)');
  expect(items[1]?.textContent).toContain('Cash');
  const local = formatInstant(new Date('2026-11-20T09:30:00.000Z'), 'en', 'Asia/Kuwait');
  expect(items[0]?.textContent).toContain(`Refunded at ${local}`);
  expect(screen.getByText(local).getAttribute('dir')).toBe('ltr');
  for (const row of rows) expect(screen.queryByText(row.refunded_at)).toBeNull();
});

it('marks the amount as left-to-right and the free-text reason as auto', () => {
  render(<PackageRefundHistory refunds={rows} timeZone="Asia/Kuwait" />);
  expect(screen.getByText('3').getAttribute('dir')).toBe('ltr');
  expect(screen.getByText('6.750').getAttribute('dir')).toBe('ltr');
  const reason = screen.getByText('Synthetic refund reason');
  expect(reason.tagName.toLowerCase()).toBe('bdi');
  expect(reason.getAttribute('dir')).toBe('auto');
});

it('hides the reason line when the refund carries none', () => {
  render(<PackageRefundHistory refunds={rows} timeZone="Asia/Kuwait" />);
  const items = screen.getAllByRole('listitem');
  expect(items[0]?.textContent).toContain('Reason: Synthetic refund reason');
  expect(items[1]?.textContent).not.toContain('Reason:');
});

it('shows the empty refund history state', () => {
  render(<PackageRefundHistory refunds={[]} timeZone="Asia/Kuwait" />);
  expect(screen.getByRole('status').textContent).toBe(t('en', 'packageRefund.historyEmpty'));
  expect(screen.queryByRole('listitem')).toBeNull();
});

it('omits the refund timestamps when the timezone is absent', () => {
  render(<PackageRefundHistory refunds={rows} timeZone={undefined} />);
  expect(screen.getAllByRole('listitem')).toHaveLength(2);
  expect(screen.queryByText(/Refunded at/)).toBeNull();
  for (const row of rows) expect(screen.queryByText(row.refunded_at)).toBeNull();
});
