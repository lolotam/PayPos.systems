import { t } from '@pospay/i18n';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { AttendanceCorrectionForm } from './attendance-correction-form';
import { AttendanceReasonForm } from './attendance-reason-form';
import { AttendanceRequestDecisionForm } from './attendance-request-decision-form';
import { AttendanceManualForm } from './attendance-manual-form';
import {
  actionSession,
  attendanceTestClient,
  boardScope,
  boardId,
  otherBoardId,
  employeesFixture,
} from '../api/attendance-actions.fixture';
const state = vi.hoisted(() => ({ locale: 'en' as 'ar' | 'en' }));
const api = vi.hoisted(() => ({ GET: vi.fn() }));
vi.mock('@/shared/locale/locale-context', () => ({ useLocale: () => state.locale }));
vi.mock('@/shared/api/client', () => ({ apiClient: () => api }));
beforeEach(() => {
  state.locale = 'en';
  api.GET.mockReset().mockResolvedValue({ data: employeesFixture });
});
it.each(['ar', 'en'] as const)('validates trimmed reason bounds in %s', async (locale) => {
  state.locale = locale;
  const save = vi.fn();
  render(<AttendanceReasonForm revision={3} pending={false} onSave={save} onClose={vi.fn()} />);
  const reason = screen.getByLabelText(t(locale, 'attendanceActions.reason'));
  for (const value of ['   ', 'a'.repeat(501)]) {
    fireEvent.change(reason, { target: { value } });
    fireEvent.submit(reason.closest('form') as HTMLFormElement);
    await screen.findByRole('alert');
    expect(save).not.toHaveBeenCalled();
  }
  fireEvent.change(reason, { target: { value: ' Synthetic reason ' } });
  fireEvent.submit(reason.closest('form') as HTMLFormElement);
  await waitFor(() =>
    expect(save).toHaveBeenCalledWith(
      { revision: 3, reason: 'Synthetic reason' },
      expect.anything(),
    ),
  );
});
it.each(['APPROVED', 'REJECTED'] as const)(
  'applies the %s reason rule from contracts',
  async (decision) => {
    const save = vi.fn();
    render(
      <AttendanceRequestDecisionForm
        decision={decision}
        revision={2}
        pending={false}
        onSave={save}
        onClose={vi.fn()}
      />,
    );
    const reason = screen.getByLabelText(
      t(
        'en',
        decision === 'APPROVED' ? 'attendanceActions.optionalReason' : 'attendanceActions.reason',
      ),
    );
    fireEvent.change(reason, { target: { value: '  ' } });
    fireEvent.submit(reason.closest('form') as HTMLFormElement);
    if (decision === 'APPROVED') await waitFor(() => expect(save).toHaveBeenCalled());
    else {
      await screen.findByRole('alert');
      expect(save).not.toHaveBeenCalled();
      fireEvent.change(reason, { target: { value: ' Synthetic rejection ' } });
      fireEvent.submit(reason.closest('form') as HTMLFormElement);
      await waitFor(() =>
        expect(save).toHaveBeenCalledWith(
          { revision: 2, decision, reason: 'Synthetic rejection' },
          expect.anything(),
        ),
      );
    }
  },
);
it.each([
  ['Asia/Kuwait', '2026-10-11T00:20', '2026-10-10T21:20:00.000Z'],
  ['America/New_York', '2026-07-12T23:30', '2026-07-13T03:30:00.000Z'],
])('validates correction and sends a UTC instant for %s', async (zone, input, expected) => {
  const save = vi.fn();
  render(
    <AttendanceCorrectionForm
      row={actionSession}
      timezone={zone}
      pending={false}
      onSave={save}
      onClose={vi.fn()}
    />,
  );
  fireEvent.change(screen.getByLabelText(t('en', 'attendanceActions.reason')), {
    target: { value: ' Synthetic correction ' },
  });
  fireEvent.click(screen.getByRole('button', { name: t('en', 'attendanceActions.save') }));
  await screen.findByRole('alert');
  expect(save).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText(t('en', 'attendanceBoard.clockIn')), {
    target: { value: input },
  });
  fireEvent.click(screen.getByRole('button', { name: t('en', 'attendanceActions.save') }));
  await waitFor(() =>
    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({ clock_in: expected, reason: 'Synthetic correction', revision: 1 }),
    ),
  );
});
it('rejects unchanged correction instants, even when timestamp precision differs', async () => {
  const save = vi.fn();
  render(
    <AttendanceCorrectionForm
      row={actionSession}
      timezone="Asia/Kuwait"
      pending={false}
      onSave={save}
      onClose={vi.fn()}
    />,
  );
  fireEvent.change(screen.getByLabelText(t('en', 'attendanceActions.reason')), {
    target: { value: 'Synthetic reason' },
  });
  fireEvent.change(screen.getByLabelText(t('en', 'attendanceBoard.clockIn')), {
    target: { value: '2026-10-11T00:30' },
  });
  fireEvent.click(screen.getByRole('button', { name: t('en', 'attendanceActions.save') }));
  await screen.findByRole('alert');
  expect(save).not.toHaveBeenCalled();
});
it('rejects a nonunique DST time in the correction form', async () => {
  const save = vi.fn();
  render(
    <AttendanceCorrectionForm
      row={actionSession}
      timezone="America/New_York"
      pending={false}
      onSave={save}
      onClose={vi.fn()}
    />,
  );
  fireEvent.change(screen.getByLabelText(t('en', 'attendanceActions.reason')), {
    target: { value: 'Synthetic reason' },
  });
  fireEvent.change(screen.getByLabelText(t('en', 'attendanceBoard.clockOut')), {
    target: { value: '2026-11-01T01:30' },
  });
  fireEvent.click(screen.getByRole('button', { name: t('en', 'attendanceActions.save') }));
  await screen.findByRole('alert');
  expect(save).not.toHaveBeenCalled();
});
it('requires an employee, both times and a reason for a manual overnight day', async () => {
  const save = vi.fn();
  const test = attendanceTestClient();
  render(
    <AttendanceManualForm
      scope={boardScope}
      timezone="Asia/Kuwait"
      pending={false}
      onSave={save}
      onClose={vi.fn()}
    />,
    { wrapper: test.wrapper },
  );
  await screen.findByRole('option', { name: 'Synthetic employee' });
  fireEvent.click(screen.getByRole('button', { name: t('en', 'attendanceActions.save') }));
  await screen.findByRole('alert');
  expect(save).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText(t('en', 'attendanceBoard.employee')), {
    target: { value: otherBoardId },
  });
  fireEvent.change(screen.getByLabelText(t('en', 'attendanceBoard.clockIn')), {
    target: { value: '2026-10-10T23:30' },
  });
  fireEvent.change(screen.getByLabelText(t('en', 'attendanceBoard.clockOut')), {
    target: { value: '2026-10-11T02:00' },
  });
  fireEvent.change(screen.getByLabelText(t('en', 'attendanceActions.reason')), {
    target: { value: ' Synthetic reason ' },
  });
  fireEvent.click(screen.getByRole('button', { name: t('en', 'attendanceActions.save') }));
  await waitFor(() =>
    expect(save).toHaveBeenCalledWith(
      {
        kind: 'ADD_SESSION',
        employee_id: otherBoardId,
        branch_id: boardId,
        clock_in: '2026-10-10T20:30:00.000Z',
        clock_out: '2026-10-10T23:00:00.000Z',
        reason: 'Synthetic reason',
      },
      expect.anything(),
    ),
  );
  test.client.clear();
});
