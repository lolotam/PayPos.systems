import { t } from '@pospay/i18n';
import { render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';

import { InvitationsPage } from './invitations-page';

// البوابة مقفولة (503 NOT_READY): الصفحة بترسم رسالة بدل النموذج (P2-b)، والفتح بيرجّعه.
const state = vi.hoisted(() => ({
  locale: 'en' as 'en' | 'ar',
  access: { isSuccess: true, isFetchedAfterMount: true, isError: false } as Record<string, unknown>,
}));

vi.mock('@/shared/locale/locale-context', () => ({ useLocale: () => state.locale }));
vi.mock('../api/use-invitations-access', () => ({
  useInvitationsAccess: () => state.access,
}));
vi.mock('../api/use-member-invitations', () => ({
  useMemberInvitations: () => ({
    query: { data: { items: [], next_cursor: null }, isPending: false, isError: false, error: undefined },
    invite: { isPending: false, isError: false, error: undefined, mutate: vi.fn(), reset: vi.fn() },
    reissue: { isPending: false, isError: false, error: undefined, mutate: vi.fn(), reset: vi.fn() },
  }),
}));
vi.mock('../ui/invitation-form', () => ({
  InvitationForm: () => <input aria-label="invitation form email" />,
}));

const choices = { businesses: [], branches: [] };
const renderPage = () =>
  render(
    <InvitationsPage companyId="company-1" userId="user-1" choices={choices} />,
  );

it('renders the form while the activation read says the routes are open', () => {
  state.access = { isSuccess: true, isFetchedAfterMount: true, isError: false };
  renderPage();
  expect(screen.getByLabelText('invitation form email')).toBeTruthy();
});

it('renders the closed-gate notice instead of the form when the API answers NOT_READY', () => {
  state.access = { isSuccess: false, isFetchedAfterMount: false, isError: true };
  renderPage();
  expect(screen.getByRole('status').textContent).toBe(t('en', 'invitations.notReady'));
  expect(screen.queryByLabelText('invitation form email')).toBeNull();
});
