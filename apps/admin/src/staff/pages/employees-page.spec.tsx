import { t } from '@pospay/i18n';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { EmployeesPage } from './employees-page';

const state = vi.hoisted(() => ({
  useEmployees: vi.fn(),
  edit: vi.fn(),
  cursor: undefined as string | undefined,
}));
vi.mock('@/shared/locale/locale-context', () => ({ useLocale: () => 'en' }));
vi.mock('../api/use-employees', () => ({
  useEmployees: (...args: unknown[]) => state.useEmployees(...args),
}));
vi.mock('../api/use-employee-numbering', () => ({
  useEmployeeNumbering: () => ({ data: undefined }),
  useSetEmployeeNumberStart: () => ({ mutate: vi.fn(), isPending: false, isError: false }),
}));
vi.mock('../api/use-passkeys', () => ({
  usePasskeyEmployees: () => ({
    isFetchedAfterMount: true,
    data: { items: [], next_cursor: null },
  }),
}));
vi.mock('../ui/employee-edit-panel', () => ({
  EmployeeEditPanel: (props: object) => {
    state.edit(props);
    return null;
  },
}));
const id = '01920000-0000-7000-8000-0000000000a2';
const next = '01920000-0000-7000-8000-0000000000a3';
const business = {
  id,
  name_en: 'Synthetic salon',
  name_ar: null,
  vertical_type: 'salon' as const,
  timezone: 'Asia/Kuwait',
  branches: [
    {
      id,
      name_ar: null,
      name_en: 'Synthetic primary',
      effective_timezone: 'Asia/Kuwait',
      is_active: true,
    },
  ],
};
it('uses the server page, opens an editor for its row and clears selection on next/first page', () => {
  state.useEmployees.mockImplementation((_company, _business, _user, cursor) => {
    state.cursor = cursor;
    return {
      isPending: false,
      isError: false,
      data: {
        items: [
          {
            id,
            name_en: 'Synthetic employee',
            name_ar: null,
            role_code: 'staff',
            hire_date: '2026-01-01',
            primary_branch_id: id,
            employee_number: null,
          },
        ],
        next_cursor: cursor ? null : next,
      },
    };
  });
  render(<EmployeesPage companyId={id} business={business} userId={id} />);
  expect(screen.getByRole('link', { name: t('en', 'staff.create') }).getAttribute('href')).toBe(
    '/staff/create',
  );
  expect(screen.getByRole('table')).toBeTruthy();
  expect(screen.getByRole('columnheader', { name: t('en', 'staff.employeeNumber') })).toBeTruthy();
  expect(screen.getByText('\u2014')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: t('en', 'staff.edit') }));
  expect(state.edit).toHaveBeenLastCalledWith(
    expect.objectContaining({ employeeId: id, companyId: id }),
  );
  state.edit.mockClear();
  fireEvent.click(screen.getByRole('button', { name: t('en', 'staff.next') }));
  expect(state.cursor).toBe(next);
  expect(state.edit).not.toHaveBeenCalled();
  expect(
    (screen.getByRole('button', { name: t('en', 'staff.next') }) as HTMLButtonElement).disabled,
  ).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: t('en', 'staff.first') }));
  expect(state.cursor).toBeUndefined();
});
it('renders a bilingual failure instead of retaining stale table rows after a refusal', () => {
  state.useEmployees.mockReturnValue({
    isPending: false,
    isError: true,
    error: { message_en: 'Synthetic refusal', message_ar: t('ar', 'staff.invalid') },
    data: { items: [], next_cursor: null },
  });
  render(<EmployeesPage companyId={id} business={business} userId={id} />);
  expect(screen.getByRole('alert').textContent).toContain('Synthetic refusal');
  expect(screen.queryByRole('table')).toBeNull();
  expect(screen.getByRole('searchbox', { name: t('en', 'staff.search') })).toBeTruthy();
});
it('sends trimmed digits and letters as q and clears q when the box is emptied', () => {
  vi.useFakeTimers();
  try {
    const seen: Array<{ cursor: string | undefined; q: string | undefined }> = [];
    state.useEmployees.mockImplementation((_company, _business, _user, cursor, q) => {
      seen.push({ cursor, q });
      state.cursor = cursor;
      return {
        isPending: false,
        isError: false,
        data: {
          items: [
            {
              id,
              name_en: 'Synthetic employee',
              name_ar: null,
              role_code: 'staff',
              hire_date: '2026-01-01',
              primary_branch_id: id,
              employee_number: 2,
            },
          ],
          next_cursor: next,
        },
      };
    });
    render(<EmployeesPage companyId={id} business={business} userId={id} />);
    expect(seen.at(-1)).toEqual({ cursor: undefined, q: undefined });
    expect(screen.getByText('2')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: t('en', 'staff.next') }));
    expect(state.cursor).toBe(next);
    const box = screen.getByRole('searchbox', { name: t('en', 'staff.search') });
    fireEvent.change(box, { target: { value: '  2  ' } });
    act(() => {
      vi.advanceTimersByTime(299);
    });
    expect(seen.at(-1)?.q).toBeUndefined();
    expect(state.cursor).toBe(next);
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(seen.at(-1)).toEqual({ cursor: undefined, q: '2' });
    fireEvent.change(box, { target: { value: 'Sara' } });
    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(seen.at(-1)).toEqual({ cursor: undefined, q: 'Sara' });
    fireEvent.change(box, { target: { value: '   ' } });
    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(seen.at(-1)).toEqual({ cursor: undefined, q: undefined });
  } finally {
    vi.useRealTimers();
  }
});
it('closes the open employee editor when a search settles', () => {
  vi.useFakeTimers();
  try {
    state.useEmployees.mockReturnValue({
      isPending: false,
      isError: false,
      data: {
        items: [
          {
            id,
            name_en: 'Synthetic employee',
            name_ar: null,
            role_code: 'staff',
            hire_date: '2026-01-01',
            primary_branch_id: id,
            employee_number: 2,
          },
        ],
        next_cursor: null,
      },
    });
    render(<EmployeesPage companyId={id} business={business} userId={id} />);
    fireEvent.click(screen.getByRole('button', { name: t('en', 'staff.edit') }));
    expect(state.edit).toHaveBeenLastCalledWith(expect.objectContaining({ employeeId: id }));
    state.edit.mockClear();
    fireEvent.change(screen.getByRole('searchbox', { name: t('en', 'staff.search') }), {
      target: { value: 'Other' },
    });
    act(() => {
      vi.advanceTimersByTime(299);
    });
    expect(state.edit).toHaveBeenCalled();
    state.edit.mockClear();
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(state.edit).not.toHaveBeenCalled();
  } finally {
    vi.useRealTimers();
  }
});
