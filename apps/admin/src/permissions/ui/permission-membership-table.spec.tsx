import type { PermissionMembership } from '@pospay/contracts';
import { t } from '@pospay/i18n';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { PermissionMembershipTable } from './permission-membership-table';

const state = vi.hoisted(() => ({ locale: 'en' as 'ar' | 'en' }));
vi.mock('@/shared/locale/locale-context', () => ({ useLocale: () => state.locale }));
const items: PermissionMembership[] = Array.from({ length: 12 }, (_, index) => ({
  id: `01920000-0000-7000-8000-${String(index).padStart(12, '0')}`,
  user_id: `01920000-0000-7000-8001-${String(index).padStart(12, '0')}`,
  employee_id: null,
  role_code: 'viewer',
  role_name_ar: null,
  role_name_en: 'Viewer',
  scope_type: 'COMPANY',
  scope_id: '01920000-0000-7000-8000-000000000099',
  starts_at: '2026-01-01T00:00:00Z',
  ends_at: null,
}));

it.each(['ar', 'en'] as const)(
  'keeps every server-page row and selects the same membership in %s',
  (locale) => {
    state.locale = locale;
    const onSelect = vi.fn();
    const first = items[0];
    const last = items[11];
    if (!first || !last) throw new Error('Synthetic membership fixtures are missing');
    render(<PermissionMembershipTable items={items} selectedId={first.id} onSelect={onSelect} />);
    const rows = within(screen.getByRole('table')).getAllByRole('row');
    expect(rows).toHaveLength(13);
    const firstRow = rows[1];
    const lastRow = rows[12];
    if (!firstRow || !lastRow) throw new Error('Server-page membership rows are missing');
    expect(
      within(firstRow)
        .getByRole('button', { name: t(locale, 'permissions.view') })
        .getAttribute('aria-pressed'),
    ).toBe('true');
    expect(within(lastRow).getByText(t(locale, 'roles.viewer'))).toBeTruthy();
    fireEvent.click(within(lastRow).getByRole('button', { name: t(locale, 'permissions.view') }));
    expect(onSelect).toHaveBeenCalledExactlyOnceWith(last.id);
  },
);

it.each(['ar', 'en'] as const)(
  'shows known scope names, shortened unknown ids and copyable holders in %s',
  (locale) => {
    state.locale = locale;
    const item = items[0];
    if (!item || !item.user_id) throw new Error('Synthetic membership fixture is missing');
    const scopes = ['COMPANY', 'BUSINESS', 'BRANCH'] as const;
    const scopedItems = scopes.map((scope_type, index) => ({
      ...item,
      id: `${item.id.slice(0, -1)}${index}`,
      scope_type,
    }));
    const scopeNames = Object.fromEntries(
      scopes.map((scope) => [`${scope}:${item.scope_id}`, `fixture.${locale}.${scope}`]),
    );
    const { rerender } = render(
      <PermissionMembershipTable
        items={scopedItems}
        selectedId=""
        onSelect={vi.fn()}
        scopeNames={scopeNames}
      />,
    );
    for (const scope of scopes) expect(screen.getByText(`fixture.${locale}.${scope}`)).toBeTruthy();
    expect(screen.queryByText(item.scope_id)).toBeNull();
    rerender(<PermissionMembershipTable items={[item]} selectedId="" onSelect={vi.fn()} />);
    const holder = screen.getByTitle(item.user_id);
    expect(holder.textContent).toBe(`${item.user_id.slice(0, 8)}…`);
    expect(holder.classList.contains('font-mono')).toBe(true);
    expect(screen.getByTitle(item.scope_id).textContent).toBe(`${item.scope_id.slice(0, 8)}…`);
    expect(screen.getByRole('button', { name: t(locale, 'permissions.copyHolder') })).toBeTruthy();
  },
);
