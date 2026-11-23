import { t } from '@pospay/i18n';
import { screen, within } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import {
  api,
  DOWNLOAD,
  expectStatementNoAccess,
  openStatement,
  requestReadyStatement,
  setup,
  state,
  SUBMIT,
} from './attendance-statement-page.fixture';
import { cardOf, follows } from './stacked-layout.helpers';

vi.mock('@/shared/api/client', () => ({ apiClient: () => api }));
vi.mock('@/shared/locale/locale-context', () => ({ useLocale: () => state.locale }));

it('puts the whole request form in one card under the heading, inside the page shell', async () => {
  const view = await openStatement();
  const heading = screen.getByRole('heading', { name: t('en', 'attendanceStatementScreen.title') });
  const branch = screen.getByLabelText(t('en', 'attendanceStatementScreen.branch'));
  const submit = screen.getByRole('button', { name: t('en', SUBMIT) });
  const card = cardOf(branch);
  expect(card.contains(submit)).toBe(true);
  expect(follows(branch, submit)).toBe(true);
  expect(card.contains(heading)).toBe(false);
  expect(heading.closest('[data-page-shell="form"]')?.contains(card)).toBe(true);
  expect(follows(heading, card)).toBe(true);
  view.close();
});

it('shows the request outcome below the form card, not inside it', async () => {
  const view = await requestReadyStatement();
  const download = await screen.findByRole('button', { name: t('en', DOWNLOAD) });
  const card = cardOf(screen.getByLabelText(t('en', 'attendanceStatementScreen.branch')));
  expect(card.contains(download)).toBe(false);
  expect(follows(card, download)).toBe(true);
  view.close();
});

it('keeps the heading and the page shell around the no-access message', async () => {
  state.shiftsError = { code: 'FORBIDDEN', status: 403 };
  const view = setup();
  await expectStatementNoAccess();
  const shell = document.querySelector('[data-page-shell="form"]') as HTMLElement;
  expect(
    within(shell).getByRole('heading', { name: t('en', 'attendanceStatementScreen.title') }),
  ).toBeTruthy();
  expect(within(shell).getByRole('alert').textContent).toBe(
    t('en', 'attendanceStatementScreen.noAccess'),
  );
  view.close();
});
