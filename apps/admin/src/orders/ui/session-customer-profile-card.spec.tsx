import { t } from '@pospay/i18n';
import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';

import { SessionCustomerProfileCard } from './session-customer-profile-card';

const state = vi.hoisted(() => ({
  query: { data: undefined as unknown, isError: false, refetch: vi.fn() },
  canRead: null as boolean | null,
}));
vi.mock('../api/use-session-customer-profile', () => ({
  useSessionCustomerProfile: (_entry: unknown, canRead: boolean) => {
    state.canRead = canRead;
    return state.query;
  },
}));

const id = '01920000-0000-7000-8000-0000000000b1';
const entry = {
  customerId: id,
  companyId: 'company',
  branchId: 'branch',
  businessId: 'business',
  userId: 'actor',
  entryScope: 'branch' as const,
};
const notes = [
  {
    business_id: '01920000-0000-7000-8000-0000000000b2',
    business_name_ar: t('ar', 'serviceSessions.note'),
    business_name_en: 'English business',
    note: 'First synthetic note',
    created_at: '2026-11-01T10:00:00.000Z',
  },
];
const profile = {
  id,
  name: 'Synthetic profile',
  locale: 'ar',
  opted_out: false,
  phone: '***123',
  birthday: { day: 29, month: 2, year: null },
  gender: 'female',
  email: 'a@b.test',
  notes,
};

function mount(locale: 'ar' | 'en') {
  return render(<SessionCustomerProfileCard {...entry} locale={locale} />);
}

it.each([
  ['ar', t('ar', 'serviceSessions.note'), t('ar', 'serviceSessions.genderFemale')],
  ['en', 'English business', 'Female'],
] as const)('shows the %s profile with a partial birthday, masked phone and named note', (locale, businessName, gender) => {
  state.query = { data: profile, isError: false, refetch: vi.fn() };
  mount(locale);
  expect(screen.getByText(gender)).toBeTruthy();
  expect(screen.getByText('29/2')).toBeTruthy();
  expect(screen.queryByText('29/2/2000')).toBeNull();
  expect(screen.getByText('***123')).toBeTruthy();
  expect(screen.getByText(businessName)).toBeTruthy();
  expect(screen.getByText('First synthetic note')).toBeTruthy();
});

it('falls back to the English business name when Arabic is absent', () => {
  state.query = {
    data: { ...profile, notes: [{ ...notes[0], business_name_ar: null }] },
    isError: false,
    refetch: vi.fn(),
  };
  mount('ar');
  expect(screen.getByText('English business')).toBeTruthy();
});

it('shows localized empty states for absent fields and an empty notes list', () => {
  state.query = {
    data: { ...profile, gender: null, birthday: null, email: null, notes: [] },
    isError: false,
    refetch: vi.fn(),
  };
  mount('en');
  expect(screen.getAllByText(t('en', 'serviceSessions.profileEmpty')).length).toBe(3);
  expect(screen.getByText(t('en', 'serviceSessions.profileNoNotes'))).toBeTruthy();
});

it('offers a retry on a failed read without a placeholder of earlier data', () => {
  const refetch = vi.fn();
  state.query = { data: undefined, isError: true, refetch };
  mount('ar');
  expect(screen.getByText(t('ar', 'serviceSessions.profileLoadFailed'))).toBeTruthy();
  expect(screen.queryByText('First synthetic note')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: t('ar', 'serviceSessions.profileRetry') }));
  expect(refetch).toHaveBeenCalledTimes(1);
});

it('blocks a card first seen offline until Retry, and does not auto-read on reconnect', () => {
  state.query = { data: undefined, isError: false, refetch: vi.fn() };
  const view = render(<SessionCustomerProfileCard {...entry} locale="en" online={false} />);
  expect(state.canRead).toBe(false);
  view.rerender(<SessionCustomerProfileCard {...entry} locale="en" online={true} />);
  expect(state.canRead).toBe(false);
  expect(state.query.refetch).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: t('en', 'serviceSessions.profileRetry') }));
  expect(state.canRead).toBe(true);
});

it('does not permanently block an unknown hydration state', () => {
  state.query = { data: undefined, isError: false, refetch: vi.fn() };
  const view = render(<SessionCustomerProfileCard {...entry} locale="en" online={null} />);
  expect(state.canRead).toBe(false);
  view.rerender(<SessionCustomerProfileCard {...entry} locale="en" online={true} />);
  expect(state.canRead).toBe(true);
});

it('shows a loading state until the selected profile arrives', () => {
  state.query = { data: undefined, isError: false, refetch: vi.fn() };
  mount('en');
  expect(screen.getByText(t('en', 'serviceSessions.profileLoading'))).toBeTruthy();
});
