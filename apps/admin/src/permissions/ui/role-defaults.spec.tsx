import { membershipPermissions } from '@pospay/contracts';
import { permissionName, t } from '@pospay/i18n';
import { render, screen, within } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { PermissionMembershipSummary } from './permission-membership-summary';
import { PermissionOverrides } from './permission-overrides';
import { PermissionOverrideForm } from './permission-override-form';

const state = vi.hoisted(() => ({ locale: 'en' as 'en' | 'ar' }));
vi.mock('@/shared/locale/locale-context', () => ({ useLocale: () => state.locale }));
const company = '01920000-0000-7000-8000-0000000000a0';
const business = '01920000-0000-7000-8000-0000000000b0';
const code = 'manage:memberships:business';
function detail(defaults: string[]) {
  return membershipPermissions.parse({
    membership: {
      id: company,
      user_id: company,
      employee_id: null,
      role_code: 'business_manager',
      role_name_ar: null,
      role_name_en: 'Business Manager',
      scope_type: 'BUSINESS',
      scope_id: business,
      starts_at: '2026-01-01T00:00:00Z',
      ends_at: null,
    },
    role_defaults: defaults,
    permission_catalog: [code],
    editing_enabled: true,
    discount_limit: { limit_bps: null },
    ended_overrides: { items: [], next_cursor: null },
    overrides: {
      items: [
        {
          id: company,
          permission_code: code,
          effect: 'ALLOW',
          scope_type: 'BUSINESS',
          scope_id: business,
          reason: 'Synthetic explicit grant',
          granted_by: company,
          granted_at: '2026-01-01T00:00:00Z',
          expires_at: null,
        },
      ],
      next_cursor: null,
    },
  });
}
it.each(['ar', 'en'] as const)(
  'keeps optional ALLOW separate from role defaults in %s',
  (locale) => {
    state.locale = locale;
    const data = detail([
      'manage:employees:business',
      'create:customers:business',
      'create:customers:branch',
      'manage:discount-limits:business',
    ]);
    render(
      <>
        <PermissionMembershipSummary data={data} timeZone="UTC" />
        <PermissionOverrides items={data.overrides.items} branchTimeZones={{}} />
      </>,
    );
    const defaults = within(
      screen.getByText(t(locale, 'permissions.defaults')).closest('section') as HTMLElement,
    );
    expect(defaults.queryByText(code)).toBeNull();
    for (const permission of [
      'read:files:business',
      'manage:files:business',
      'manage:document-types:company',
    ])
      expect(defaults.queryByText(permission)).toBeNull();
    for (const permission of data.role_defaults) {
      expect(defaults.getByText(permission)).toBeTruthy();
      expect(defaults.getByText(permissionName(locale, permission), { exact: false })).toBeTruthy();
    }
    expect(screen.getByText(code)).toBeTruthy();
    expect(screen.getByText(t(locale, 'permissions.allow'))).toBeTruthy();
  },
);
it.each(['ar', 'en'] as const)(
  'shows a default and its overriding DENY as separate facts in %s',
  (locale) => {
    state.locale = locale;
    const data = detail([code]);
    render(
      <>
        <PermissionMembershipSummary data={data} timeZone="UTC" />
        <PermissionOverrides
          items={data.overrides.items.map((row) => ({ ...row, effect: 'DENY' }))}
          branchTimeZones={{}}
        />
      </>,
    );
    expect(screen.getAllByText(code)).toHaveLength(2);
    expect(screen.getByText(t(locale, 'permissions.deny'))).toBeTruthy();
  },
);
it.each(['ar', 'en'] as const)(
  'defaults the scoped override form to the selected business in %s',
  (locale) => {
    state.locale = locale;
    render(
      <PermissionOverrideForm
        catalog={[code]}
        companyId={company}
        businessId={business}
        disabled={false}
        pending={false}
        onSave={vi.fn()}
      />,
    );
    expect(screen.getByLabelText(t(locale, 'permissions.scopeId'))).toHaveProperty(
      'value',
      business,
    );
    expect(screen.getByLabelText(t(locale, 'permissions.scope')).textContent).toContain(
      t(locale, 'permissions.business'),
    );
  },
);

it.each(['ar', 'en'] as const)(
  'shows company decisions read-only inside business management in %s',
  (locale) => {
    state.locale = locale;
    const row = detail([]).overrides.items[0];
    if (row === undefined) throw new Error('Synthetic decision missing');
    render(
      <PermissionOverrides
        items={[
          { ...row, id: company, effect: 'DENY', scope_type: 'COMPANY', scope_id: company },
          { ...row, id: business },
        ]}
        branchTimeZones={{}}
        businessScoped
        onRevoke={vi.fn()}
      />,
    );
    expect(screen.getByText(t(locale, 'permissions.deny'))).toBeTruthy();
    expect(screen.getAllByRole('button', { name: t(locale, 'permissions.revoke') })).toHaveLength(
      1,
    );
  },
);

it.each(['ar', 'en'] as const)(
  'shows schedule defaults and delegated salaries separately in %s',
  (locale) => {
    state.locale = locale;
    const codes = [
      'read:schedules:branch',
      'manage:schedules:branch',
      'read:schedules:business',
      'manage:schedules:business',
    ];
    const data = detail(codes);
    const decision = data.overrides.items[0];
    if (decision === undefined) throw new Error('Synthetic decision missing');
    decision.permission_code = 'read:salaries:business';
    render(
      <>
        <PermissionMembershipSummary data={data} timeZone="UTC" />
        <PermissionOverrides items={data.overrides.items} branchTimeZones={{}} />
      </>,
    );
    const defaults = within(
      screen.getByText(t(locale, 'permissions.defaults')).closest('section') as HTMLElement,
    );
    for (const permission of codes)
      expect(defaults.getByText(permissionName(locale, permission), { exact: false })).toBeTruthy();
    expect(defaults.queryByText('read:salaries:business')).toBeNull();
    expect(
      screen.getByText(permissionName(locale, 'read:salaries:business'), { exact: false }),
    ).toBeTruthy();
  },
);
