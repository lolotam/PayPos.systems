import { t } from '@pospay/i18n';
import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { attendanceTestClient, boardScope, requestPage } from '../api/attendance-actions.fixture';
import type { AttendanceRequestRow } from '../model/attendance-action-display';
import { AttendanceRequestRowActions } from './attendance-request-row-actions';
import { AttendanceRequestEditor } from './attendance-request-editor';

const api = vi.hoisted(() => ({ GET: vi.fn() }));
vi.mock('@/shared/api/client', () => ({ apiClient: () => api }));
vi.mock('@/shared/locale/locale-context', () => ({ useLocale: () => 'en' }));
const pending = requestPage.items[0] as AttendanceRequestRow;
const branchIds = [
  boardScope.branchId,
  '00000000-0000-4000-8000-000000000002',
  '00000000-0000-4000-8000-000000000003',
];
const restoreRow = (index: number): AttendanceRequestRow => {
  const id = `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`;
  return {
    ...pending,
    id,
    branch_id: branchIds[index % 3] as string,
    status: 'APPROVED',
    can_decide: false,
    can_cancel: false,
    session_state: { voided: true, void_request_id: id, restore_pending: false },
  };
};
beforeEach(() => {
  vi.useFakeTimers();
  api.GET.mockReset().mockResolvedValue({
    data: { correct: false, resolve: false, request_change: true, decide: false },
  });
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute('open', '');
  };
});
afterEach(() => vi.useRealTimers());

it('shares at most three lazy capability requests for fifty restore rows, without polling', async () => {
  const test = attendanceTestClient();
  const rows = Array.from({ length: 50 }, (_, index) => restoreRow(index));
  const view = render(
    <>
      {rows.map((row) => (
        <AttendanceRequestRowActions
          key={row.id}
          scope={{ ...boardScope, branchId: row.branch_id }}
          row={row}
          onAction={vi.fn()}
        />
      ))}
    </>,
    { wrapper: test.wrapper },
  );
  await act(() => vi.advanceTimersByTimeAsync(100));
  expect(
    screen.getAllByRole('button', { name: t('en', 'attendanceActions.restore') }),
  ).toHaveLength(50);
  expect(api.GET).toHaveBeenCalledTimes(3);
  expect(new Set(api.GET.mock.calls.map(([, options]) => options.params.path.branchId))).toEqual(
    new Set(branchIds),
  );
  await act(() => vi.advanceTimersByTimeAsync(90_000));
  expect(api.GET).toHaveBeenCalledTimes(3);
  view.unmount();
  test.client.clear();
});
it('fetches no capabilities for decide/cancel rows or their editors, then fetches only when restore becomes eligible', async () => {
  const test = attendanceTestClient();
  const rows = Array.from({ length: 50 }, (_, index) => ({
    ...pending,
    id: String(index),
    branch_id: branchIds[index % 3] as string,
  }));
  const view = render(
    <>
      {rows.map((row) => (
        <AttendanceRequestRowActions
          key={row.id}
          scope={{ ...boardScope, branchId: row.branch_id }}
          row={row}
          onAction={vi.fn()}
        />
      ))}
      <AttendanceRequestEditor
        scope={boardScope}
        row={pending}
        action="approve"
        onClose={vi.fn()}
      />
      <AttendanceRequestEditor
        scope={boardScope}
        row={pending}
        action="withdraw"
        onClose={vi.fn()}
      />
    </>,
    { wrapper: test.wrapper },
  );
  await act(() => vi.advanceTimersByTimeAsync(90_000));
  expect(api.GET).not.toHaveBeenCalled();
  expect(screen.getAllByRole('dialog')).toHaveLength(2);
  view.rerender(
    <AttendanceRequestRowActions scope={boardScope} row={restoreRow(0)} onAction={vi.fn()} />,
  );
  await act(() => vi.advanceTimersByTimeAsync(100));
  expect(api.GET).toHaveBeenCalledTimes(1);
  expect(screen.getByRole('button', { name: t('en', 'attendanceActions.restore') })).toBeTruthy();
  view.unmount();
  test.client.clear();
});
