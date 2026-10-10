import { formatInstant, t } from '@pospay/i18n';
import { render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { EmployeePasskeySection } from './employee-passkey-section';

const state = vi.hoisted(() => ({
  locale: 'ar' as 'ar' | 'en',
  since: null as string | null,
  locked: true,
}));
vi.mock('@/shared/locale/locale-context', () => ({ useLocale: () => state.locale }));
vi.mock('../api/use-passkeys', () => ({
  useEmployeePasskeys: () => ({
    history: {
      isFetchedAfterMount: true,
      isError: false,
      data: {
        status: {
          bound: true,
          binding_id: 'synthetic',
          revision: 1,
          bound_at: '2026-10-10T00:00:00Z',
          phone_locked: state.locked,
          phone_locked_since: state.since,
        },
        items: [],
        next_cursor: null,
        can_unbind: true,
      },
    },
    unbind: { isPending: false, isError: false, isSuccess: false, mutate: vi.fn() },
  }),
}));

it.each(['ar', 'en'] as const)(
  'shows the phone lock, known date and release explanation in %s',
  (locale) => {
    state.locale = locale;
    state.since = '2026-10-10T00:00:00Z';
    state.locked = true;
    const view = render(
      <EmployeePasskeySection
        companyId="company"
        businessId="business"
        userId="manager"
        employeeId="employee"
        timeZone="Asia/Kuwait"
      />,
    );
    const locked = screen.getByText((text) => text.includes(t(locale, 'phoneLock.locked')));
    expect(locked.textContent).toContain(
      formatInstant(new Date(state.since), locale, 'Asia/Kuwait'),
    );
    expect(screen.getByText(t(locale, 'phoneLock.release'))).toBeTruthy();
    view.unmount();
  },
);

it('does not invent a date for a legacy attachment', () => {
  state.since = null;
  const view = render(
    <EmployeePasskeySection
      companyId="company"
      businessId="business"
      userId="manager"
      employeeId="employee"
      timeZone="Asia/Kuwait"
    />,
  );
  expect(screen.getByText(t(state.locale, 'phoneLock.locked'))).toBeTruthy();
  expect(
    screen.queryByText((text) => text.includes(t(state.locale, 'phoneLock.since'))),
  ).toBeNull();
  view.unmount();
});
