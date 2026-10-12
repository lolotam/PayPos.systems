import { formatInstant, t } from '@pospay/i18n';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { attendanceTestClient, boardScope, requestPage } from '../api/attendance-actions.fixture';
import { boardBranches } from '../api/attendance-board.fixture';
import { AttendanceRequestsPage } from './attendance-requests-page';

const state = vi.hoisted(() => ({ locale: 'en' as 'ar' | 'en' }));
const api = vi.hoisted(() => ({ GET: vi.fn() }));
vi.mock('@/shared/locale/locale-context', () => ({ useLocale: () => state.locale }));
vi.mock('@/shared/api/client', () => ({ apiClient: () => api }));

vi.mock('@/staff/api/use-attendance-capabilities', () => ({
  useAttendanceCapabilities: () => ({
    isPending: false,
    capabilities: { correct: true, resolve: true, request_change: true, decide: true },
  }),
}));
beforeEach(() => api.GET.mockReset());

const cases = (['ar', 'en'] as const).flatMap((locale) =>
  (['VOID_SESSION', 'RESTORE_SESSION'] as const).flatMap((kind) =>
    boardBranches.map((branch) => ({ locale, kind, branch })),
  ),
);
it.each(cases)(
  'formats $kind actor timestamps in the selected branch timezone ($locale)',
  async ({ locale, kind, branch }) => {
    state.locale = locale;
    const requestedAt = '2026-10-10T22:30:00Z';
    const decidedAt = '2026-10-11T02:45:00Z';
    api.GET.mockResolvedValue({
      data: {
        items: [
          {
            ...requestPage.items[0],
            branch_id: branch.id,
            kind,
            status: 'APPROVED',
            requested: null,
            requested_at: requestedAt,
            decided_at: decidedAt,
            decided_by: boardScope.userId,
            decided_by_name: null,
            can_decide: false,
            can_cancel: false,
          },
        ],
        next_cursor: null,
      },
    });
    const test = attendanceTestClient();
    const view = render(
      <AttendanceRequestsPage
        scope={{ ...boardScope, branchId: branch.id }}
        branches={boardBranches}
        onBranch={vi.fn()}
      />,
      { wrapper: test.wrapper },
    );
    fireEvent.change(screen.getByLabelText(t(locale, 'attendanceBoard.status')), {
      target: { value: 'APPROVED' },
    });
    await screen.findByRole('table');
    for (const instant of [requestedAt, decidedAt]) {
      expect(
        screen.getByText(formatInstant(new Date(instant), locale, branch.effective_timezone)),
      ).toBeTruthy();
      expect(screen.queryByText(formatInstant(new Date(instant), locale, 'UTC'))).toBeNull();
    }
    view.unmount();
    test.client.clear();
  },
);
