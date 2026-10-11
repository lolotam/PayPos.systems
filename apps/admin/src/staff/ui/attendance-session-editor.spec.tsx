import { t, errorMessages } from '@pospay/i18n';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { AttendanceSessionEditor } from './attendance-session-editor';
import {
  actionSession,
  attendanceTestClient,
  boardScope,
  boardId,
  otherBoardId,
  requestRecord,
  correctionResult,
} from '../api/attendance-actions.fixture';
const state = vi.hoisted(() => ({ locale: 'en' as 'en' | 'ar' }));
const api = vi.hoisted(() => ({ POST: vi.fn() }));
vi.mock('@/shared/api/client', () => ({ apiClient: () => api }));
vi.mock('@/shared/locale/locale-context', () => ({ useLocale: () => state.locale }));
beforeEach(() => {
  state.locale = 'en';
  api.POST.mockReset();
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute('open', '');
  };
});
it.each([
  'ATTENDANCE_CORRECTION_INVALID_TIMES',
  'ATTENDANCE_CORRECTION_WORKING_DATE',
  'ATTENDANCE_SESSION_REVISION_CONFLICT',
] as const)('shows server %s beside the correction', async (code) => {
  const messages = errorMessages(code);
  api.POST.mockResolvedValue({
    error: { code, ...messages },
    response: { status: code === 'ATTENDANCE_SESSION_REVISION_CONFLICT' ? 409 : 422 },
  });
  const test = attendanceTestClient();
  const onClose = vi.fn();
  const view = render(
    <AttendanceSessionEditor
      scope={boardScope}
      row={actionSession}
      action="correct"
      timezone="Asia/Kuwait"
      onClose={onClose}
    />,
    { wrapper: test.wrapper },
  );
  const dialog = screen.getByRole('dialog');
  fireEvent.change(within(dialog).getByLabelText(t('en', 'attendanceBoard.clockOut')), {
    target: { value: '2026-10-11T04:00' },
  });
  fireEvent.change(within(dialog).getByLabelText(t('en', 'attendanceActions.reason')), {
    target: { value: 'Synthetic correction reason' },
  });
  fireEvent.click(within(dialog).getByRole('button', { name: t('en', 'attendanceActions.save') }));
  await screen.findByText(messages.message_en);
  expect(onClose).not.toHaveBeenCalled();
  view.unmount();
  test.client.clear();
});
it('creates a void request from the selected board session and refetches after success', async () => {
  api.POST.mockResolvedValue({ data: requestRecord });
  const test = attendanceTestClient();
  const onClose = vi.fn();
  const invalidate = vi.spyOn(test.client, 'invalidateQueries');
  const view = render(
    <AttendanceSessionEditor
      scope={boardScope}
      row={actionSession}
      action="void"
      timezone="Asia/Kuwait"
      onClose={onClose}
    />,
    { wrapper: test.wrapper },
  );
  fireEvent.change(screen.getByLabelText(t('en', 'attendanceActions.reason')), {
    target: { value: ' Synthetic void reason ' },
  });
  fireEvent.click(screen.getByRole('button', { name: t('en', 'attendanceActions.save') }));
  await waitFor(() => expect(onClose).toHaveBeenCalled());
  expect(api.POST.mock.calls[0]?.[1].body).toEqual({
    kind: 'VOID_SESSION',
    employee_id: otherBoardId,
    session_id: boardId,
    session_revision: 1,
    reason: 'Synthetic void reason',
  });
  expect(invalidate).toHaveBeenCalledWith({ queryKey: ['attendance-board', boardId, boardId] });
  view.unmount();
  test.client.clear();
});
it.each(['ar', 'en'] as const)(
  'submits a clock-out-only correction and closes after refetch in %s',
  async (locale) => {
    state.locale = locale;
    api.POST.mockResolvedValue({ data: correctionResult });
    const test = attendanceTestClient();
    const onClose = vi.fn();
    const view = render(
      <AttendanceSessionEditor
        scope={boardScope}
        row={actionSession}
        action="correct"
        timezone="Asia/Kuwait"
        onClose={onClose}
      />,
      { wrapper: test.wrapper },
    );
    fireEvent.change(screen.getByLabelText(t(locale, 'attendanceBoard.clockOut')), {
      target: { value: '2026-10-11T04:00' },
    });
    fireEvent.change(screen.getByLabelText(t(locale, 'attendanceActions.reason')), {
      target: { value: 'Synthetic correction' },
    });
    fireEvent.click(screen.getByRole('button', { name: t(locale, 'attendanceActions.save') }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(api.POST.mock.calls[0]?.[1].body).toEqual({
      revision: 1,
      clock_out: '2026-10-11T01:00:00.000Z',
      reason: 'Synthetic correction',
    });
    view.unmount();
    test.client.clear();
  },
);
