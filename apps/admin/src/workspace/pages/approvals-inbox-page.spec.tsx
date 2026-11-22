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

it('says nothing is waiting when the user may see no approval page', () => {
  render(<ApprovalsInboxPage kinds={[]} />);
  expect(screen.getByText(t('en', 'adminNav.approvalsInboxEmpty'))).toBeTruthy();
  expect(screen.queryAllByRole('link')).toHaveLength(0);
});
