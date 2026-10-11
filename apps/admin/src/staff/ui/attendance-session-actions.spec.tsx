import { t } from '@pospay/i18n';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { AttendanceSessionActions } from './attendance-session-actions';
import { AttendanceSourceBadge } from './attendance-source-badge';
import { AttendanceSessionBadges } from './attendance-session-badges';
import { actionSession, boardId, otherBoardId } from '../api/attendance-actions.fixture';
const state = vi.hoisted(() => ({ locale: 'en' as 'ar' | 'en' }));
vi.mock('@/shared/locale/locale-context', () => ({ useLocale: () => state.locale }));
beforeEach(() => {
  state.locale = 'en';
});
it.each(['OPEN', 'CLOSED', 'MISSED_OUT'] as const)(
  'shows only status-valid actions for %s',
  (status) => {
    const action = vi.fn();
    render(<AttendanceSessionActions row={{ ...actionSession, status }} onAction={action} />);
    expect(
      screen.queryByRole('option', { name: t('en', 'attendanceActions.correct') }) !== null,
    ).toBe(status !== 'OPEN');
    expect(screen.queryByRole('option', { name: t('en', 'attendanceActions.void') }) !== null).toBe(
      status !== 'OPEN',
    );
    expect(screen.getByRole('option', { name: t('en', 'attendanceActions.history') })).toBeTruthy();
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'history' } });
    expect(action).toHaveBeenCalledWith(expect.objectContaining({ status }), 'history');
  },
);
it('offers void and history for a manual day, following ACR-Q10', () => {
  render(
    <AttendanceSessionActions
      row={{ ...actionSession, status: 'CLOSED', source: 'MANUAL' }}
      onAction={vi.fn()}
    />,
  );
  expect(screen.queryByRole('option', { name: t('en', 'attendanceActions.correct') })).toBeNull();
  expect(screen.getByRole('option', { name: t('en', 'attendanceActions.void') })).toBeTruthy();
});
it.each(['ar', 'en'] as const)(
  'shows manual actor names and the neutral null fallback in %s',
  (locale) => {
    state.locale = locale;
    render(
      <AttendanceSourceBadge
        source="MANUAL"
        manual={{
          change_request_id: boardId,
          requested_by: boardId,
          approved_by: otherBoardId,
          requested_by_name: { ar: 'Synthetic requester ar', en: 'Synthetic requester' },
          approved_by_name: null,
        }}
      />,
    );
    expect(
      screen.getByText(
        new RegExp(locale === 'ar' ? 'Synthetic requester ar' : 'Synthetic requester'),
      ),
    ).toBeTruthy();
    expect(
      screen.getByText(
        new RegExp(
          `${t(locale, 'attendanceActions.approvedBy')}: ${t(locale, 'attendanceActions.user')}`,
        ),
      ),
    ).toBeTruthy();
  },
);
it('links each open exception badge to the exceptions screen', () => {
  render(<AttendanceSessionBadges row={actionSession} />);
  expect(screen.getAllByRole('link').map((link) => link.getAttribute('href'))).toEqual([
    '/staff/attendance-exceptions',
    '/staff/attendance-exceptions',
    '/staff/attendance-exceptions',
  ]);
});
