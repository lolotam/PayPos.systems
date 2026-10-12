import { t } from '@pospay/i18n';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { attendanceTestClient, boardScope, requestPage } from '../api/attendance-actions.fixture';
import { boardBranches, boardId, otherBoardId } from '../api/attendance-board.fixture';
import { AttendanceRequestsPage } from './attendance-requests-page';

const api = vi.hoisted(() => ({ GET: vi.fn() }));
vi.mock('@/shared/api/client', () => ({ apiClient: () => api }));
vi.mock('@/shared/locale/locale-context', () => ({ useLocale: () => 'ar' }));
beforeEach(() => {
  api.GET.mockReset();
});
function setup() {
  const test = attendanceTestClient();
  const view = render(
    <AttendanceRequestsPage scope={boardScope} branches={boardBranches} onBranch={vi.fn()} />,
    { wrapper: test.wrapper },
  );
  return {
    ...test,
    close: () => {
      view.unmount();
      test.client.clear();
    },
  };
}
it.each([false, true])(
  'decide-only approver defaults to all branches with empty=%s and no board read',
  async (empty) => {
    api.GET.mockImplementation(async (path) =>
      path.endsWith('attendance-capabilities')
        ? { error: { code: 'NOT_FOUND' }, response: { status: 404 } }
        : {
            data: {
              can_decide_any: true,
              items: empty ? [] : [{ ...requestPage.items[0], branch_id: otherBoardId }],
              next_cursor: null,
            },
          },
    );
    const view = setup();
    await screen.findByRole('option', { name: t('ar', 'attendanceActions.allBranches') });
    if (empty) await screen.findByText(t('ar', 'attendanceActions.empty'));
    else await screen.findByRole('table');
    const branchPicker = screen.getByLabelText(
      t('ar', 'attendanceBoard.branch'),
    ) as HTMLSelectElement;
    expect(branchPicker.value).toBe('all');
    const requests = api.GET.mock.calls.filter(([path]) =>
      path.endsWith('attendance-change-requests'),
    );
    expect(requests).toHaveLength(2);
    expect(requests.every(([, options]) => !('branch_id' in options.params.query))).toBe(true);
    expect(requests[0]?.[1].params.query).toEqual({ limit: 1 });
    fireEvent.change(branchPicker, { target: { value: boardId } });
    await waitFor(() =>
      expect(api.GET.mock.calls.at(-1)?.[1].params.query.branch_id).toBe(boardId),
    );
    view.close();
  },
);
it('branch-only reader has no all-branches option and loads the selected branch', async () => {
  api.GET.mockImplementation(async (path) =>
    path.endsWith('attendance-capabilities')
      ? { data: { correct: false, resolve: false, request_change: false, decide: false } }
      : { data: { ...requestPage, can_decide_any: false, items: [], next_cursor: null } },
  );
  const view = setup();
  await screen.findByText(t('ar', 'attendanceActions.empty'));
  expect(screen.queryByRole('option', { name: t('ar', 'attendanceActions.allBranches') })).toBeNull();
  expect(
    (screen.getByLabelText(t('ar', 'attendanceBoard.branch')) as HTMLSelectElement).value,
  ).toBe(boardId);
  expect(api.GET.mock.calls.at(-1)?.[1].params.query.branch_id).toBe(boardId);
  view.close();
});
