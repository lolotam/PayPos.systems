import { t } from '@pospay/i18n';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import {
  api,
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
