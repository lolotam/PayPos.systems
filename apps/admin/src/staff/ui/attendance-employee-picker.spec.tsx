import { t } from '@pospay/i18n';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import {
  attendanceTestClient,
  boardScope,
  boardId,
  otherBoardId,
  employeesFixture,
} from '../api/attendance-actions.fixture';
import { AttendanceManualForm } from './attendance-manual-form';
const state = vi.hoisted(() => ({ locale: 'en' as 'ar' | 'en' }));
const api = vi.hoisted(() => ({ GET: vi.fn() }));
vi.mock('@/shared/locale/locale-context', () => ({ useLocale: () => state.locale }));
vi.mock('@/shared/api/client', () => ({ apiClient: () => api }));
beforeEach(() => {
  state.locale = 'en';
  api.GET.mockReset();
});
function renderManual() {
  const test = attendanceTestClient();
  const save = vi.fn();
  const view = render(
    <AttendanceManualForm
      scope={boardScope}
      timezone="Asia/Kuwait"
      pending={false}
      onSave={save}
      onClose={vi.fn()}
    />,
    { wrapper: test.wrapper },
  );
  return {
    save,
    close: () => {
      view.unmount();
      test.client.clear();
    },
  };
}
it.each(['ar', 'en'] as const)(
  'searches names, clears the selected employee and handles no results in %s',
  async (locale) => {
    state.locale = locale;
    api.GET.mockResolvedValue({ data: employeesFixture });
    const test = renderManual();
    await screen.findByRole('option', { name: 'Synthetic employee' });
    const select = screen.getByLabelText(
      t(locale, 'attendanceBoard.employee'),
    ) as HTMLSelectElement;
    fireEvent.change(select, { target: { value: otherBoardId } });
    expect(select.value).toBe(otherBoardId);
    api.GET.mockResolvedValue({ data: { items: [], next_cursor: null } });
    fireEvent.change(screen.getByLabelText(t(locale, 'attendanceActions.searchEmployee')), {
      target: { value: 'Other' },
    });
    await screen.findByText(t(locale, 'attendanceActions.noEmployees'));
    expect(select.value).toBe('');
    expect(screen.queryByRole('option', { name: 'Synthetic employee' })).toBeNull();
    expect(api.GET.mock.calls.at(-1)?.[1].params.query).toEqual({ limit: 50, search: 'Other' });
    test.close();
  },
);
it('loads another names page without submitting the manual-day form', async () => {
  const cursor = JSON.stringify(['Synthetic employee', otherBoardId]);
  api.GET.mockResolvedValueOnce({
    data: { ...employeesFixture, next_cursor: cursor },
  }).mockResolvedValueOnce({
    data: { items: [{ id: boardId, name_ar: null, name_en: 'Next employee' }], next_cursor: null },
  });
  const test = renderManual();
  await screen.findByRole('option', { name: 'Synthetic employee' });
  fireEvent.click(screen.getByRole('button', { name: t('en', 'attendanceBoard.loadMore') }));
  await screen.findByRole('option', { name: 'Next employee' });
  expect(screen.getByRole('option', { name: 'Synthetic employee' })).toBeTruthy();
  expect(api.GET.mock.calls.at(-1)?.[1].params.query.cursor).toBe(cursor);
  expect(screen.queryByRole('button', { name: t('en', 'attendanceBoard.loadMore') })).toBeNull();
  expect(screen.queryByRole('alert')).toBeNull();
  expect(test.save).not.toHaveBeenCalled();
  test.close();
});
it.each(['NOT_FOUND', 'FORBIDDEN', 'FEATURE_DISABLED'] as const)(
  'shows %s and retries without submitting',
  async (code) => {
    api.GET.mockResolvedValueOnce({
      error: { code },
      response: { status: 403 },
    }).mockResolvedValueOnce({ data: employeesFixture });
    const test = renderManual();
    const key =
      code === 'NOT_FOUND' ? 'notFound' : code === 'FORBIDDEN' ? 'forbidden' : 'featureDisabled';
    await screen.findByText(t('en', `attendanceActions.${key}`));
    expect(screen.queryByRole('option', { name: 'Synthetic employee' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: t('en', 'attendanceBoard.retry') }));
    await screen.findByRole('option', { name: 'Synthetic employee' });
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
    expect(test.save).not.toHaveBeenCalled();
    test.close();
  },
);
