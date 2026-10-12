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

const api = vi.hoisted(() => ({ GET: vi.fn() }));
vi.mock('@/shared/locale/locale-context', () => ({ useLocale: () => 'en' }));
vi.mock('@/shared/api/client', () => ({ apiClient: () => api }));
beforeEach(() => {
  api.GET.mockReset();
});
const selected = { id: boardId, name_ar: null, name_en: 'Next employee' };
const duplicate = { ...selected, id: otherBoardId };
const cursor = JSON.stringify(['Synthetic employee', otherBoardId]);
const matchingCursor = JSON.stringify(['Next employee', otherBoardId]);

async function selectSecondPage() {
  const test = attendanceTestClient();
  api.GET.mockResolvedValueOnce({
    data: { ...employeesFixture, next_cursor: cursor },
  }).mockResolvedValueOnce({ data: { items: [selected], next_cursor: null } });
  const view = render(
    <AttendanceManualForm
      scope={boardScope}
      timezone="Asia/Kuwait"
      pending={false}
      onSave={vi.fn()}
      onClose={vi.fn()}
    />,
    { wrapper: test.wrapper },
  );
  await screen.findByRole('option', { name: 'Synthetic employee' });
  fireEvent.click(screen.getByRole('button', { name: t('en', 'attendanceBoard.loadMore') }));
  await screen.findByRole('option', { name: selected.name_en });
  const employee = screen.getByLabelText(t('en', 'attendanceBoard.employee')) as HTMLSelectElement;
  fireEvent.change(employee, { target: { value: selected.id } });
  return {
    employee,
    close: () => {
      view.unmount();
      test.client.clear();
    },
  };
}
it.each([true, false])(
  'checks every matching page after changing date; eligible = %s',
  async (eligible) => {
    const test = await selectSecondPage();
    let finish: (value: unknown) => void = () => {};
    api.GET.mockImplementation(async (_path, { params }) => {
      if (!params.query.search) return { data: { ...employeesFixture, next_cursor: cursor } };
      if (!params.query.cursor)
        return { data: { items: [duplicate], next_cursor: matchingCursor } };
      return new Promise((resolve) => {
        finish = resolve;
      });
    });
    fireEvent.change(screen.getByLabelText(t('en', 'attendanceBoard.clockIn')), {
      target: { value: '2026-10-12T09:00' },
    });
    await waitFor(() =>
      expect(api.GET.mock.calls.at(-1)?.[1].params.query).toEqual({
        limit: 50,
        search: selected.name_en,
        date: '2026-10-12',
        cursor: matchingCursor,
      }),
    );
    expect(test.employee.value).toBe(selected.id);
    expect(screen.getByRole('option', { name: selected.name_en })).toBeTruthy();
    finish({ data: { items: eligible ? [selected] : [], next_cursor: null } });
    await waitFor(() => expect(test.employee.value).toBe(eligible ? selected.id : ''));
    test.close();
  },
);
it('keeps a page-two selection when the eligibility search fails', async () => {
  const test = await selectSecondPage();
  api.GET.mockImplementation(async (_path, { params }) => {
    if (params.query.search) throw new Error('Synthetic outage');
    return { data: { ...employeesFixture, next_cursor: cursor } };
  });
  fireEvent.change(screen.getByLabelText(t('en', 'attendanceBoard.clockIn')), {
    target: { value: '2026-10-12T09:00' },
  });
  await waitFor(() => expect(api.GET).toHaveBeenCalledTimes(4));
  expect(test.employee.value).toBe(selected.id);
  test.close();
});
