import { t, type Locale } from '@pospay/i18n';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import {
  actionSession,
  attendanceTestClient,
  boardScope,
  boardId,
  exceptionPage,
  requestPage,
  employeesFixture,
} from '../api/attendance-actions.fixture';
import { AttendanceSessionEditor } from './attendance-session-editor';
import { AttendanceExceptionEditor } from './attendance-exception-editor';
import { AttendanceRequestEditor } from './attendance-request-editor';
import { AttendanceManualEditor } from './attendance-manual-editor';
const state = vi.hoisted(() => ({ locale: 'en' as Locale }));
const api = vi.hoisted(() => ({ GET: vi.fn(), POST: vi.fn() }));
vi.mock('@/shared/locale/locale-context', () => ({ useLocale: () => state.locale }));
vi.mock('@/shared/api/client', () => ({ apiClient: () => api }));
const actions = [
  'correct',
  'resolve',
  'reopen',
  'void',
  'restore',
  'manual',
  'approve',
  'reject',
  'withdraw',
] as const;
type Action = (typeof actions)[number];
const refusals = [
  ['UNAUTHENTICATED', 401],
  ['FORBIDDEN', 403],
  ['NOT_FOUND', 404],
] as const;
const cases = [
  ...actions.flatMap((action) =>
    refusals.flatMap(([code, status]) =>
      (['ar', 'en'] as const).map((locale) => ({ action, code, status, locale })),
    ),
  ),
  ...(
    [
      ['correct', 'ATTENDANCE_CORRECTION_SELF_FORBIDDEN'],
      ['resolve', 'ATTENDANCE_EXCEPTION_SELF_FORBIDDEN'],
      ['approve', 'ATTENDANCE_CHANGE_SELF_FORBIDDEN'],
    ] as const
  ).flatMap(([action, code]) =>
    (['ar', 'en'] as const).map((locale) => ({ action, code, status: 403, locale })),
  ),
];
beforeEach(() => {
  api.GET.mockReset().mockResolvedValue({ data: employeesFixture });
  api.POST.mockReset();
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute('open', '');
  };
});
function editor(action: Action, onClose: () => void) {
  const props = { scope: boardScope, onClose };
  if (action === 'manual') return <AttendanceManualEditor {...props} timezone="Asia/Kuwait" />;
  if (action === 'correct' || action === 'void')
    return (
      <AttendanceSessionEditor
        {...props}
        row={actionSession}
        action={action}
        timezone="Asia/Kuwait"
      />
    );
  const exception = exceptionPage.items[0];
  const request = requestPage.items[0];
  if (!exception || !request) throw new Error('Missing synthetic rows');
  if (action === 'resolve' || action === 'reopen')
    return (
      <AttendanceExceptionEditor
        {...props}
        row={{ ...exception, status: action === 'resolve' ? 'OPEN' : 'RESOLVED' }}
      />
    );
  return (
    <AttendanceRequestEditor
      {...props}
      action={action}
      row={
        action === 'restore'
          ? {
              ...request,
              status: 'APPROVED',
              session_state: { voided: true, void_request_id: request.id, restore_pending: false },
            }
          : request
      }
    />
  );
}
async function submit(action: Action, locale: Locale) {
  if (action === 'correct')
    fireEvent.change(screen.getByLabelText(t(locale, 'attendanceBoard.clockOut')), {
      target: { value: '2026-10-11T04:00' },
    });
  if (action === 'manual') {
    fireEvent.change(screen.getByLabelText(t(locale, 'attendanceBoard.clockIn')), {
      target: { value: '2026-10-11T00:30' },
    });
    fireEvent.change(screen.getByLabelText(t(locale, 'attendanceBoard.clockOut')), {
      target: { value: '2026-10-11T04:00' },
    });
    await screen.findByRole('option', { name: 'Synthetic employee' });
    fireEvent.change(screen.getByLabelText(t(locale, 'attendanceBoard.employee')), {
      target: { value: employeesFixture.items[0]?.id },
    });
  }
  if (action !== 'withdraw' && action !== 'approve')
    fireEvent.change(screen.getByLabelText(t(locale, 'attendanceActions.reason')), {
      target: { value: 'Synthetic reason' },
    });
  const button =
    action === 'withdraw' || action === 'approve' || action === 'reject' ? action : 'save';
  fireEvent.click(screen.getByRole('button', { name: t(locale, `attendanceActions.${button}`) }));
}
it.each(cases)(
  '$action shows the $status message in $locale',
  async ({ action, code, status, locale }) => {
    state.locale = locale;
    api.POST.mockResolvedValue({
      error: {
        code,
        message_ar: 'Synthetic unrelated AR message',
        message_en: 'Synthetic unrelated EN message',
      },
      response: { status },
    });
    const test = attendanceTestClient();
    const onClose = vi.fn();
    const view = render(editor(action, onClose), { wrapper: test.wrapper });
    await submit(action, locale);
    await screen.findByText(
      code.startsWith('ATTENDANCE_')
        ? locale === 'ar'
          ? 'Synthetic unrelated AR message'
          : 'Synthetic unrelated EN message'
        : t(
            locale,
            status === 401
              ? 'attendanceBoard.sessionExpired'
              : 'attendanceActions.permissionDenied',
          ),
    );
    await waitFor(() => expect(api.POST).toHaveBeenCalledTimes(1));
    expect(api.POST.mock.calls[0]?.[1].params.path.businessId).toBe(boardId);
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(onClose).not.toHaveBeenCalled();
    view.unmount();
    test.client.clear();
  },
);
