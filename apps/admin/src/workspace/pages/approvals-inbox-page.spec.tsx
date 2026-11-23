import { t } from '@pospay/i18n';
import { render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';

import { ApprovalsInboxPage } from './approvals-inbox-page';

vi.mock('@/shared/locale/locale-context', () => ({ useLocale: () => 'en' }));

it('lists each kind of approval as a link to its page', () => {
  render(
    <ApprovalsInboxPage
      kinds={[
        { id: 'leave-approvals', label: 'Leave approvals', href: '/leave' },
        {
          id: 'attendance-requests',
          label: 'Attendance requests',
          href: '/staff/attendance-requests',
        },
      ]}
    />,
  );
  expect(
    screen.getByRole('heading', { name: t('en', 'adminNavPages.approvalsInbox') }),
  ).toBeTruthy();
  expect(screen.getByRole('link', { name: 'Leave approvals' }).getAttribute('href')).toBe('/leave');
  expect(screen.getAllByRole('link')).toHaveLength(2);
  expect(screen.queryByText(t('en', 'adminNav.approvalsInboxEmpty'))).toBeNull();
});

it('says no approval list is available once the checks finish and the user may see none', () => {
  render(<ApprovalsInboxPage kinds={[]} />);
  const empty = screen.getByText(t('en', 'adminNav.approvalsInboxEmpty'));
  expect(empty.textContent).not.toMatch(/waiting|pending|nothing/i);
  expect(screen.queryAllByRole('link')).toHaveLength(0);
});

it('shows a loading state, not the empty text, while the permission checks are running', () => {
  render(<ApprovalsInboxPage kinds={[]} state="loading" />);
  expect(screen.getByRole('status').textContent).toBe(t('en', 'admin.loading'));
  expect(screen.queryByText(t('en', 'adminNav.approvalsInboxEmpty'))).toBeNull();
});

it('says the lists could not be checked when a check failed, and still lists the kinds it has', () => {
  render(
    <ApprovalsInboxPage
      kinds={[{ id: 'leave-approvals', label: 'Leave approvals', href: '/leave' }]}
      state="failed"
    />,
  );
  expect(screen.getByRole('alert').textContent).toBe(t('en', 'adminNav.approvalsInboxFailed'));
  expect(screen.getByRole('link', { name: 'Leave approvals' })).toBeTruthy();
});

it('keeps the known links but still shows loading while another check is running', () => {
  render(
    <ApprovalsInboxPage
      kinds={[{ id: 'leave-approvals', label: 'Leave approvals', href: '/leave' }]}
      state="loading"
    />,
  );
  expect(screen.getByRole('status').textContent).toBe(t('en', 'admin.loading'));
  expect(screen.getByRole('link', { name: 'Leave approvals' })).toBeTruthy();
});
