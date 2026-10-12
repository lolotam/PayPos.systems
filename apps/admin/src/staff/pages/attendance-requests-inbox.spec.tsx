import { t } from '@pospay/i18n';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import {
  attendanceTestClient,
  boardScope,
  requestPage,
  employeesFixture,
} from '../api/attendance-actions.fixture';
import { boardBranches, boardId, otherBoardId } from '../api/attendance-board.fixture';
import { AttendanceRequestsPage } from './attendance-requests-page';

const api = vi.hoisted(() => ({ GET: vi.fn() }));
vi.mock('@/shared/api/client', () => ({ apiClient: () => api }));
vi.mock('@/shared/locale/locale-context', () => ({ useLocale: () => 'ar' }));
beforeEach(() => {
  api.GET.mockReset();
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute('open', '');
  };
});
function setup() {
  const test = attendanceTestClient();
  const view = render(
    <AttendanceRequestsPage scope={boardScope} branches={boardBranches} onBranch={vi.fn()} />,
    { wrapper: test.wrapper },
  );
  return {
    ...test,
    ...view,
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
              can_request: false,
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
    expect(requests[0]?.[1].params.query).toEqual({ limit: 1, branch_id: boardId });
    expect(requests[1]?.[1].params.query).not.toHaveProperty('branch_id');
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
  expect(
    screen.queryByRole('option', { name: t('ar', 'attendanceActions.allBranches') }),
  ).toBeNull();
  expect(
    (screen.getByLabelText(t('ar', 'attendanceBoard.branch')) as HTMLSelectElement).value,
  ).toBe(boardId);
  expect(api.GET.mock.calls.at(-1)?.[1].params.query.branch_id).toBe(boardId);
  view.close();
});
it.each([true, false])(
  'request-only user with board read denied sees creation=%s from the requests list',
  async (canRequest) => {
    api.GET.mockImplementation(async (path, options) => {
      if (path.endsWith('attendance-capabilities'))
        return { error: { code: 'NOT_FOUND' }, response: { status: 404 } };
      if (path.endsWith('attendance-employees')) return { data: employeesFixture };
      return {
        data: {
          can_request: options.params.query.branch_id === boardId && canRequest,
          can_decide_any: false,
          items: [],
          next_cursor: null,
        },
      };
    });
    const view = setup();
    await screen.findByText(t('ar', 'attendanceActions.empty'));
    const manual = screen.queryByRole('button', { name: t('ar', 'attendanceActions.manual') });
    expect(Boolean(manual)).toBe(canRequest);
    expect(api.GET.mock.calls.some(([path]) => path.endsWith('attendance-capabilities'))).toBe(
      false,
    );
    if (manual) {
      fireEvent.click(manual);
      await screen.findByRole('dialog');
      api.GET.mockResolvedValue({ error: { code: 'NOT_FOUND' }, response: { status: 404 } });
      await view.client.invalidateQueries({ queryKey: ['attendance-actions'] });
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
      expect(
        screen.queryByRole('button', { name: t('ar', 'attendanceActions.manual') }),
      ).toBeNull();
    }
    view.close();
  },
);
it('creation fails closed while loading and after switching to a denied branch', async () => {
  let ready: (() => void) | undefined;
  const pending = new Promise<void>((resolve) => {
    ready = resolve;
  });
  api.GET.mockImplementation(async (_path, options) => {
    await pending;
    return {
      data: {
        can_request: options.params.query.branch_id === boardId,
        can_decide_any: false,
        items: [],
        next_cursor: null,
      },
    };
  });
  const view = setup();
  expect(screen.queryByRole('button', { name: t('ar', 'attendanceActions.manual') })).toBeNull();
  ready?.();
  await screen.findByRole('button', { name: t('ar', 'attendanceActions.manual') });
  view.rerender(
    <AttendanceRequestsPage
      scope={{ ...boardScope, branchId: otherBoardId }}
      branches={boardBranches}
      onBranch={vi.fn()}
    />,
  );
  expect(screen.queryByRole('button', { name: t('ar', 'attendanceActions.manual') })).toBeNull();
  await screen.findByText(t('ar', 'attendanceActions.empty'));
  expect(screen.queryByRole('button', { name: t('ar', 'attendanceActions.manual') })).toBeNull();
  view.close();
});
