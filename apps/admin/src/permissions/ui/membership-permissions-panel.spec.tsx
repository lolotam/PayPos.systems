import { membershipPermissions } from '@pospay/contracts';
import { t } from '@pospay/i18n';
import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';

import { MembershipPermissionsPanel } from './membership-permissions-panel';

const company = '01920000-0000-7000-8000-0000000000a0';
const fixture = membershipPermissions.parse({
  membership: {
    id: company,
    user_id: company,
    employee_id: null,
    role_code: 'viewer',
    role_name_ar: null,
    role_name_en: 'Viewer',
    scope_type: 'COMPANY',
    scope_id: company,
    starts_at: '2026-01-01T00:00:00Z',
    ends_at: null,
  },
  role_defaults: [],
  permission_catalog: ['read:memberships:company'],
  editing_enabled: false,
  ended_overrides: { items: [], next_cursor: null },
  overrides: {
    items: [
      {
        id: company,
        permission_code: 'read:memberships:company',
        effect: 'DENY',
        scope_type: 'COMPANY',
        scope_id: company,
        reason: 'synthetic reason',
        granted_by: company,
        granted_at: '2026-01-01T00:00:00Z',
        expires_at: null,
      },
    ],
    next_cursor: null,
  },
});
const state = vi.hoisted(() => ({
  locale: 'en' as 'ar' | 'en',
  error: false,
  editing: false,
  revoke: vi.fn(),
  mutationError: false,
}));
vi.mock('@/shared/locale/locale-context', () => ({ useLocale: () => state.locale }));
vi.mock('../api/use-permissions', () => ({
  usePermissions: () => ({
    detail: {
      isPending: false,
      isError: state.error,
      error: {},
      data: { ...fixture, editing_enabled: state.editing },
    },
    save: { isPending: false, isSuccess: false, isError: false, mutate: vi.fn() },
    revoke: {
      isPending: false,
      isSuccess: false,
      isError: state.mutationError,
      mutate: state.revoke,
      error: {
        code: 'PERMISSION_NOT_HELD',
        message_ar: t('ar', 'errors.PERMISSION_NOT_HELD'),
        message_en: 'You do not currently hold this permission over the target scope',
      },
    },
  }),
}));

it.each(['en', 'ar'] as const)(
  'shows real defaults, DENY, final localized role and read-only availability in %s',
  (locale) => {
    state.locale = locale;
    state.error = false;
    state.editing = false;
    state.mutationError = false;
    render(
      <MembershipPermissionsPanel companyId={company} userId={company} membershipId={company} />,
    );
    expect(screen.getByText(t(locale, 'permissions.noDefaults'))).toBeTruthy();
    expect(screen.getAllByText(t(locale, 'permissions.deny')).length).toBeGreaterThan(0);
    expect(screen.getByRole('status').textContent).toBe(t(locale, 'permissions.readOnly'));
    expect(screen.getByText(t(locale, 'roles.viewer'))).toBeTruthy();
    expect(screen.getByText(t(locale, 'permissions.history'))).toBeTruthy();
    expect(
      screen.getByRole('button', { name: t(locale, 'permissions.save') }).closest('fieldset')
        ?.disabled,
    ).toBe(true);
  },
);
it.each(['ar', 'en'] as const)(
  'enables edits and sends a validated mandatory revoke reason in %s',
  (locale) => {
    state.locale = locale;
    state.error = false;
    state.editing = true;
    state.mutationError = false;
    state.revoke.mockClear();
    render(
      <MembershipPermissionsPanel companyId={company} userId={company} membershipId={company} />,
    );
    expect(
      screen.getByRole('button', { name: t(locale, 'permissions.save') }).closest('fieldset')
        ?.disabled,
    ).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: t(locale, 'permissions.revoke') }));
    expect(state.revoke).not.toHaveBeenCalled();
    fireEvent.change(
      screen.getByLabelText(t(locale, 'permissions.reason'), {
        selector: `input[id="revoke-${company}"]`,
      }),
      { target: { value: ' synthetic revoke ' } },
    );
    fireEvent.click(screen.getByRole('button', { name: t(locale, 'permissions.revoke') }));
    expect(state.revoke).toHaveBeenCalledWith({
      overrideId: company,
      reason: 'synthetic revoke',
    });
  },
);
it.each(['ar', 'en'] as const)('shows the named policy error in %s', (locale) => {
  state.locale = locale;
  state.error = false;
  state.editing = true;
  state.mutationError = true;
  render(
    <MembershipPermissionsPanel companyId={company} userId={company} membershipId={company} />,
  );
  expect(screen.getByRole('alert').textContent).toBe(t(locale, 'errors.PERMISSION_NOT_HELD'));
  state.mutationError = false;
});
it('shows a localized error and removes stale editable controls after a refused refresh', () => {
  state.error = true;
  state.locale = 'en';
  render(
    <MembershipPermissionsPanel companyId={company} userId={company} membershipId={company} />,
  );
  expect(screen.getByRole('alert').textContent).toBe(t('en', 'admin.unexpected'));
  expect(screen.queryByRole('button', { name: t('en', 'permissions.save') })).toBeNull();
});
