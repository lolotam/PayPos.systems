import { t } from '@pospay/i18n';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import {
  api,
  mockPendingStatementShifts,
  mockStatementShifts,
  setup,
  state,
  submitButton,
} from './attendance-statement-page.fixture';

vi.mock('@/shared/api/client', () => ({ apiClient: () => api }));
vi.mock('@/shared/locale/locale-context', () => ({ useLocale: () => state.locale }));

it('shows a retry and disables branch submission when the shifts read fails', async () => {
  state.shiftsError = { code: 'UPSTREAM_FAILED', status: 500 };
  const view = setup();
  await screen.findByText(t('en', 'attendanceStatementScreen.shiftsLoadFailed'));
  expect(
    screen.getByRole('button', { name: t('en', 'attendanceStatementScreen.shiftsRetry') }),
  ).toBeTruthy();
  expect(screen.queryByLabelText(t('en', 'attendanceStatementScreen.shift'))).toBeNull();
  expect(submitButton().disabled).toBe(true);
  view.close();
});

it('restores the shift filter and enables submission after a successful retry', async () => {
  state.shiftsError = { code: 'UPSTREAM_FAILED', status: 500 };
  const view = setup();
  const retry = await screen.findByRole('button', {
    name: t('en', 'attendanceStatementScreen.shiftsRetry'),
  });
  state.shiftsError = undefined;
  fireEvent.click(retry);
  expect(await screen.findByLabelText(t('en', 'attendanceStatementScreen.shift'))).toBeTruthy();
  expect(screen.queryByText(t('en', 'attendanceStatementScreen.shiftsLoadFailed'))).toBeNull();
  await waitFor(() => expect(submitButton().disabled).toBe(false));
  view.close();
});

it('does not show the failure message for a successful empty shift list', async () => {
  mockStatementShifts({ shifts: [] });
  const view = setup();
  await screen.findByRole('option', { name: /Synthetic employee/ });
  expect(screen.queryByText(t('en', 'attendanceStatementScreen.shiftsLoadFailed'))).toBeNull();
  expect(
    screen.queryByRole('button', { name: t('en', 'attendanceStatementScreen.shiftsRetry') }),
  ).toBeNull();
  expect(screen.queryByLabelText(t('en', 'attendanceStatementScreen.shift'))).toBeNull();
  expect(submitButton().disabled).toBe(false);
  view.close();
});

it('keeps the failure and disabled submit visible while a retry is pending', async () => {
  state.shiftsError = { code: 'UPSTREAM_FAILED', status: 500 };
  const view = setup();
  const retry = await screen.findByRole('button', {
    name: t('en', 'attendanceStatementScreen.shiftsRetry'),
  });
  state.shiftsError = undefined;
  mockPendingStatementShifts();
  fireEvent.click(retry);
  expect(screen.getByText(t('en', 'attendanceStatementScreen.shiftsLoadFailed'))).toBeTruthy();
  expect(screen.queryByLabelText(t('en', 'attendanceStatementScreen.shift'))).toBeNull();
  expect(submitButton().disabled).toBe(true);
  view.close();
});

it('clears a selected shift that is missing from a successful reload', async () => {
  const view = setup();
  const select = (await screen.findByLabelText(
    t('en', 'attendanceStatementScreen.shift'),
  )) as HTMLSelectElement;
  fireEvent.change(select, { target: { value: '09:00|20:00' } });
  expect(select.value).toBe('09:00|20:00');
  mockStatementShifts({ shifts: [{ start: '10:00', end: '18:00' }] });
  await view.client.refetchQueries({ queryKey: ['attendance-statement-shifts'] });
  await waitFor(() => {
    const current = screen.getByLabelText(
      t('en', 'attendanceStatementScreen.shift'),
    ) as HTMLSelectElement;
    expect(current.value).toBe('');
  });
  const all = screen.getByRole('option', {
    name: t('en', 'attendanceStatementScreen.shiftAll'),
  }) as HTMLOptionElement;
  expect(all.selected).toBe(true);
  view.close();
});
