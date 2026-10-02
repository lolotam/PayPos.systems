import { membershipPermissions } from '@pospay/contracts';
import { t } from '@pospay/i18n';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

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
const state = vi.hoisted(() => ({ locale: 'en' as 'ar' | 'en', error: false }));
vi.mock('@/shared/locale/locale-context', () => ({ useLocale: () => state.locale }));
vi.mock('../api/use-permissions', () => ({
  usePermissions: () => ({
    detail: { isPending: false, isError: state.error, error: {}, data: fixture },
    save: { isPending: false, isSuccess: false, isError: false, mutate: vi.fn() },
  }),
}));

describe('permissions panel', () => {
  it.each(['en', 'ar'] as const)(
    'shows real defaults, DENY and the unresolved policy in %s',
    (locale) => {
      state.locale = locale;
      state.error = false;
      render(
        <MembershipPermissionsPanel companyId={company} userId={company} membershipId={company} />,
      );
      expect(screen.getByText(t(locale, 'permissions.noDefaults'))).toBeTruthy();
      expect(screen.getByText(t(locale, 'permissions.deny'), { selector: 'span' })).toBeTruthy();
      expect(screen.getByRole('status').textContent).toBe(t(locale, 'permissions.policyPending'));
      expect(
        screen.getByRole('button', { name: t(locale, 'permissions.save') }).closest('fieldset')
          ?.disabled,
      ).toBe(true);
    },
  );
  it('shows a localized error and removes stale editable controls after a refused refresh', () => {
    state.error = true;
    state.locale = 'en';
    render(
      <MembershipPermissionsPanel companyId={company} userId={company} membershipId={company} />,
    );
    expect(screen.getByRole('alert').textContent).toBe(t('en', 'admin.unexpected'));
    expect(screen.queryByRole('button', { name: t('en', 'permissions.save') })).toBeNull();
  });
});
