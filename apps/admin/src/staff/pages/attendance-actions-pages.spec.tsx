import { t, formatInstant } from '@pospay/i18n';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { AttendanceExceptionsPage } from './attendance-exceptions-page';
import { AttendanceRequestsPage } from './attendance-requests-page';
import {
  attendanceTestClient,
  boardScope,
  boardId,
  otherBoardId,
  exceptionPage,
  exceptionRecord,
  requestPage,
  requestRecord,
  historyFixture,
} from '../api/attendance-actions.fixture';
import { boardBranches } from '../api/attendance-board.fixture';
import { AttendanceHistoryDialog } from '../ui/attendance-history-dialog';
const state = vi.hoisted(() => ({ locale: 'en' as 'en' | 'ar' }));
const api = vi.hoisted(() => ({ GET: vi.fn(), POST: vi.fn() }));
vi.mock('@/shared/api/client', () => ({ apiClient: () => api }));
vi.mock('@/shared/locale/locale-context', () => ({ useLocale: () => state.locale }));
beforeEach(() => {
  state.locale = 'en';
  api.GET.mockReset();
  api.POST.mockReset();
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute('open', '');
  };
});
function setup(kind: 'exceptions' | 'requests') {
  const test = attendanceTestClient();
  const onBranch = vi.fn();
  const Page = kind === 'exceptions' ? AttendanceExceptionsPage : AttendanceRequestsPage;
  const view = render(<Page scope={boardScope} branches={boardBranches} onBranch={onBranch} />, {
    wrapper: test.wrapper,
  });
  return {
    ...test,
    onBranch,
    close: () => {
      view.unmount();
      test.client.clear();
    },
  };
}
it.each(['ar', 'en'] as const)(
  'pages exceptions, links branch choice, and resolves with the row revision in %s',
  async (locale) => {
    state.locale = locale;
    api.GET.mockImplementation(async (_path, options) => ({
      data: options.params.query.cursor
        ? {
            items: [
              exceptionPage.items[0],
              {
                ...exceptionPage.items[0],
                id: otherBoardId,
                employee: { id: otherBoardId, name_ar: null, name_en: 'Synthetic second employee' },
              },
            ],
            next_cursor: null,
          }
        : exceptionPage,
    }));
    api.POST.mockResolvedValue({ data: exceptionRecord });
    const view = setup('exceptions');
    await screen.findByText('Synthetic employee');
    expect(
      screen.getAllByText(formatInstant(new Date('2026-10-10T21:30:00Z'), locale, 'Asia/Kuwait'))
        .length,
    ).toBe(2);
    fireEvent.click(screen.getByRole('button', { name: t(locale, 'attendanceBoard.loadMore') }));
    await screen.findByText('Synthetic second employee');
    expect(screen.getAllByText('Synthetic employee')).toHaveLength(1);
    fireEvent.change(screen.getByLabelText(t(locale, 'attendanceBoard.branch')), {
      target: { value: otherBoardId },
    });
    expect(view.onBranch).toHaveBeenCalledWith(otherBoardId);
    fireEvent.click(
      screen.getAllByRole('button', {
        name: t(locale, 'attendanceActions.resolve'),
      })[0] as HTMLElement,
    );
    const dialog = screen.getByRole('dialog');
    expect(
      within(dialog).getByText(new RegExp(t(locale, 'attendanceActions.ACKNOWLEDGED'))),
    ).toBeTruthy();
    fireEvent.change(within(dialog).getByLabelText(t(locale, 'attendanceActions.reason')), {
      target: { value: ' Synthetic resolve reason ' },
    });
    fireEvent.click(
      within(dialog).getByRole('button', { name: t(locale, 'attendanceActions.save') }),
    );
    await waitFor(() => expect(api.POST).toHaveBeenCalled());
    expect(api.POST.mock.calls[0]?.[1].body).toEqual({
      revision: 3,
      reason: 'Synthetic resolve reason',
    });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(api.GET.mock.calls.length).toBeGreaterThan(2);
    view.close();
  },
);
it('uses the RESOLVED tab, exposes reopen only for manual kinds, and renders a 409 refusal', async () => {
  api.GET.mockResolvedValue({
    data: {
      ...exceptionPage,
      items: [
        { ...exceptionPage.items[0], status: 'RESOLVED' },
        {
          ...exceptionPage.items[0],
          id: otherBoardId,
          kind: 'SUSPECTED_MISSED_OUT',
          status: 'RESOLVED',
        },
      ],
      next_cursor: null,
    },
  });
  api.POST.mockResolvedValue({
    error: {
      code: 'ATTENDANCE_EXCEPTION_REVISION_CONFLICT',
      message_ar: 'Synthetic ar conflict',
      message_en: 'Synthetic revision refusal',
    },
    response: { status: 409 },
  });
  const view = setup('exceptions');
  fireEvent.click(screen.getByRole('button', { name: t('en', 'attendanceActions.RESOLVED') }));
  await screen.findByRole('button', { name: t('en', 'attendanceActions.reopen') });
  expect(screen.getAllByRole('button', { name: t('en', 'attendanceActions.reopen') })).toHaveLength(
    1,
  );
  expect(api.GET.mock.calls.at(-1)?.[1].params.query.status).toBe('RESOLVED');
  fireEvent.click(screen.getByRole('button', { name: t('en', 'attendanceActions.reopen') }));
  fireEvent.change(screen.getByLabelText(t('en', 'attendanceActions.reason')), {
    target: { value: 'Synthetic reason' },
  });
  fireEvent.click(screen.getByRole('button', { name: t('en', 'attendanceActions.save') }));
  await screen.findByText('Synthetic revision refusal');
  expect(screen.getByRole('dialog')).toBeTruthy();
  view.close();
});
it.each(['NOT_FOUND', 'FORBIDDEN', 'FEATURE_DISABLED'] as const)(
  'shows a clear %s message and hides the list after access loss',
  async (code) => {
    api.GET.mockResolvedValue({ data: { ...exceptionPage, next_cursor: null } });
    const view = setup('exceptions');
    await screen.findByRole('table');
    api.GET.mockResolvedValue({
      error: { code },
      response: { status: code === 'NOT_FOUND' ? 404 : 403 },
    });
    await view.client.invalidateQueries({ queryKey: ['attendance-actions'] });
    await screen.findByText(
      t(
        'en',
        code === 'FEATURE_DISABLED'
          ? 'attendanceActions.featureDisabled'
          : code === 'NOT_FOUND'
            ? 'attendanceActions.notFound'
            : 'attendanceActions.forbidden',
      ),
    );
    expect(screen.queryByRole('table')).toBeNull();
    view.close();
  },
);
it('pages requests, displays actor names and follows server action flags', async () => {
  api.GET.mockImplementation(async (_path, options) => ({
    data: options.params.query.cursor
      ? {
          items: [
            requestPage.items[0],
            {
              ...requestPage.items[0],
              id: otherBoardId,
              employee: { id: otherBoardId, name_ar: null, name_en: 'Synthetic second employee' },
              can_decide: false,
              can_cancel: false,
            },
          ],
          next_cursor: null,
        }
      : requestPage,
  }));
  const view = setup('requests');
  await screen.findByText('Synthetic requester');
  fireEvent.click(screen.getByRole('button', { name: t('en', 'attendanceBoard.loadMore') }));
  await screen.findByText('Synthetic second employee');
  expect(screen.getAllByText('Synthetic employee')).toHaveLength(1);
  expect(
    screen.getAllByRole('button', { name: t('en', 'attendanceActions.approve') }),
  ).toHaveLength(1);
  expect(
    screen.getAllByRole('button', { name: t('en', 'attendanceActions.withdraw') }),
  ).toHaveLength(1);
  view.close();
});
it('starts restore from an approved void and sends the post-void revision', async () => {
  api.GET.mockResolvedValue({
    data: {
      items: [
        {
          ...requestPage.items[0],
          status: 'APPROVED',
          can_decide: false,
          can_cancel: false,
          decided_by: otherBoardId,
          decided_by_name: { ar: null, en: 'Synthetic decider' },
        },
      ],
      next_cursor: null,
    },
  });
  api.POST.mockResolvedValue({ data: requestRecord });
  const view = setup('requests');
  fireEvent.change(screen.getByLabelText(t('en', 'attendanceBoard.status')), {
    target: { value: 'APPROVED' },
  });
  await screen.findByText('Synthetic decider');
  fireEvent.click(screen.getByRole('button', { name: t('en', 'attendanceActions.restore') }));
  fireEvent.change(screen.getByLabelText(t('en', 'attendanceActions.reason')), {
    target: { value: ' Synthetic restore reason ' },
  });
  fireEvent.click(screen.getByRole('button', { name: t('en', 'attendanceActions.save') }));
  await waitFor(() => expect(api.POST).toHaveBeenCalled());
  expect(api.POST.mock.calls[0]?.[1].body).toEqual({
    kind: 'RESTORE_SESSION',
    employee_id: otherBoardId,
    session_id: boardId,
    session_revision: 4,
    reason: 'Synthetic restore reason',
  });
  view.close();
});
it('withdraws with only the request revision after confirmation', async () => {
  api.GET.mockResolvedValue({ data: { ...requestPage, next_cursor: null } });
  api.POST.mockResolvedValue({ data: requestRecord });
  const view = setup('requests');
  fireEvent.click(
    await screen.findByRole('button', { name: t('en', 'attendanceActions.withdraw') }),
  );
  fireEvent.click(
    within(screen.getByRole('dialog')).getByRole('button', {
      name: t('en', 'attendanceActions.withdraw'),
    }),
  );
  await waitFor(() => expect(api.POST.mock.calls[0]?.[1].body).toEqual({ revision: 2 }));
  view.close();
});
it.each(['ar', 'en'] as const)(
  'shows correction history times, reason and actor in %s',
  async (locale) => {
    state.locale = locale;
    api.GET.mockResolvedValue({ data: historyFixture });
    const test = attendanceTestClient();
    const view = render(
      <AttendanceHistoryDialog
        scope={boardScope}
        sessionId={boardId}
        timezone="Asia/Kuwait"
        onClose={vi.fn()}
      />,
      { wrapper: test.wrapper },
    );
    await screen.findByText('Synthetic corrector');
    expect(screen.getByText('Synthetic correction reason')).toBeTruthy();
    expect(screen.getAllByText(new RegExp('→')).length).toBe(2);
    view.unmount();
    test.client.clear();
  },
);
