import { t } from '@pospay/i18n';
import { QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { createQueryClient } from '@/shared/api/query-client';
import { EndMembershipSection } from './end-membership-section';

const ids = {
  company: '01920000-0000-7000-8000-0000000000a0',
  user: '01920000-0000-7000-8000-0000000000a1',
  membership: '01920000-0000-7000-8000-0000000000a2',
};
const state = vi.hoisted(() => ({
  locale: 'en' as 'ar' | 'en',
  staffAccess: true,
  role: 'owner',
  isOwner: undefined as boolean | undefined,
  post: vi.fn(),
}));
vi.mock('@/shared/locale/locale-context', () => ({ useLocale: () => state.locale }));
vi.mock('@/shared/api/client', () => ({ apiClient: () => ({ POST: state.post }) }));
vi.mock('@/workspace/model/workspace-provider', () => ({
  useWorkspace: () => ({
    status: 'ready',
    companies: [],
    staffAccess: state.staffAccess,
    choose: vi.fn(),
    company: { role_code: state.role, is_owner: state.isOwner },
  }),
}));

beforeEach(() => {
  Object.assign(state, { staffAccess: true, role: 'owner', isOwner: undefined });
  state.post.mockReset();
});
afterEach(() => vi.restoreAllMocks());

function renderSection(ended = false) {
  const client = createQueryClient();
  const invalidate = vi.spyOn(client, 'invalidateQueries');
  render(
    <QueryClientProvider client={client}>
      <EndMembershipSection
        companyId={ids.company}
        userId={ids.user}
        membership={{ id: ids.membership, ends_at: ended ? '2026-01-01T00:00:00Z' : null }}
      />
    </QueryClientProvider>,
  );
  return invalidate;
}
const label = (key: Parameters<typeof t>[1]) => t(state.locale, key);

it.each(['ar', 'en'] as const)('hides the action unless every condition holds in %s', (locale) => {
  state.locale = locale;
  const closed = [
    () => (state.staffAccess = false),
    () => Object.assign(state, { staffAccess: true, role: 'general_manager', isOwner: false }),
  ];
  for (const arrange of closed) {
    arrange();
    const view = render(
      <QueryClientProvider client={createQueryClient()}>
        <EndMembershipSection
          companyId={ids.company}
          userId={ids.user}
          membership={{ id: ids.membership, ends_at: null }}
        />
      </QueryClientProvider>,
    );
    expect(screen.queryByRole('button', { name: label('permissions.endMembership') })).toBeNull();
    view.unmount();
  }
  Object.assign(state, { staffAccess: true, role: 'owner' });
  renderSection(true);
  expect(screen.queryByRole('button', { name: label('permissions.endMembership') })).toBeNull();
});

it.each(['ar', 'en'] as const)('confirm dialog, cancel and confirm in %s', async (locale) => {
  state.locale = locale;
  state.isOwner = true;
  state.role = 'general_manager';
  state.post.mockResolvedValue({
    data: { id: ids.membership, ends_at: '2026-11-25T10:00:00Z' },
    error: undefined,
  });
  const invalidate = renderSection();
  fireEvent.click(screen.getByRole('button', { name: label('permissions.endMembership') }));
  expect(await screen.findByText(label('permissions.endMembershipLead'))).toBeTruthy();
  expect(state.post).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: label('permissions.endMembershipCancel') }));
  await waitFor(() =>
    expect(screen.queryByText(label('permissions.endMembershipLead'))).toBeNull(),
  );
  expect(state.post).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: label('permissions.endMembership') }));
  fireEvent.click(
    await screen.findByRole('button', { name: label('permissions.endMembershipConfirm') }),
  );
  await waitFor(() => expect(state.post).toHaveBeenCalledTimes(1));
  expect(state.post.mock.calls[0]?.[0]).toBe('/v1/memberships/{membershipId}/end');
  expect(state.post.mock.calls[0]?.[1]).toMatchObject({
    params: { header: { 'x-company-id': ids.company }, path: { membershipId: ids.membership } },
  });
  await waitFor(() =>
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['permissions', ids.company, ids.user] }),
  );
  await waitFor(() =>
    expect(screen.queryByText(label('permissions.endMembershipLead'))).toBeNull(),
  );
});

it.each(['ar', 'en'] as const)('shows the localized LAST_OWNER refusal in %s', async (locale) => {
  state.locale = locale;
  state.post.mockResolvedValue({
    data: undefined,
    error: {
      code: 'LAST_OWNER',
      message_ar: t('ar', 'errors.LAST_OWNER'),
      message_en: t('en', 'errors.LAST_OWNER'),
    },
  });
  renderSection();
  fireEvent.click(screen.getByRole('button', { name: label('permissions.endMembership') }));
  fireEvent.click(
    await screen.findByRole('button', { name: label('permissions.endMembershipConfirm') }),
  );
  const alert = await screen.findByRole('alert');
  expect(alert.textContent).toBe(t(locale, 'errors.LAST_OWNER'));
});
