import { t } from '@pospay/i18n';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { LeaveInboxPage } from './leave-inbox-page';
import {
  leaveDecisionRecord as row,
  leaveDecisionScope as scope,
  leaveId as id,
} from '../api/leave-decision.fixture';
const state = vi.hoisted(() => ({ locale: 'en' as 'ar' | 'en' }));
const api = vi.hoisted(() => ({ GET: vi.fn(), POST: vi.fn() }));
vi.mock('@/shared/api/client', () => ({ apiClient: () => api }));
vi.mock('@/shared/locale/locale-context', () => ({ useLocale: () => state.locale }));
const branches = [
  {
    id,
    name_en: 'Synthetic branch',
    name_ar: null,
    is_active: true,
    effective_timezone: 'Asia/Kuwait',
  },
];
it.each(['ar', 'en'] as const)(
  'rejects with reason and applies branch/date inbox filters in %s',
  async (locale) => {
    state.locale = locale;
    api.GET.mockResolvedValue({
      data: {
        items: [{ ...row, status: 'PENDING', can_decide: true, can_revoke: false }],
        next_cursor: null,
        request_branch_ids: [],
      },
    });
    api.POST.mockResolvedValue({
      data: {
        ...row,
        status: 'REJECTED',
        decision_reason: 'Synthetic refusal',
        rejection_reason: 'Synthetic refusal',
      },
    });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const view = render(
      <QueryClientProvider client={client}>
        <LeaveInboxPage scope={scope} branches={branches} />
      </QueryClientProvider>,
    );
    await screen.findByText('Synthetic employee');
    fireEvent.click(screen.getByRole('button', { name: t(locale, 'leave.reject') }));
    fireEvent.change(screen.getByLabelText(t(locale, 'leave.reason')), {
      target: { value: '  Synthetic refusal  ' },
    });
    const decisionForm = screen.getByLabelText(t(locale, 'leave.reason')).closest('form');
    if (!decisionForm) throw new Error('Missing decision form');
    fireEvent.submit(decisionForm);
    await waitFor(() =>
      expect(api.POST.mock.calls.at(-1)?.[1].body).toEqual({
        decision: 'REJECTED',
        expected_revision: 2,
        reason: 'Synthetic refusal',
      }),
    );
    fireEvent.change(screen.getByLabelText(t(locale, 'leave.branch')), { target: { value: id } });
    fireEvent.change(screen.getByLabelText(t(locale, 'leave.from')), {
      target: { value: '2027-01-01' },
    });
    fireEvent.change(screen.getByLabelText(t(locale, 'leave.to')), {
      target: { value: '2027-01-31' },
    });
    fireEvent.click(screen.getByRole('button', { name: t(locale, 'leave.applyFilters') }));
    await waitFor(() =>
      expect(api.GET.mock.calls.at(-1)?.[1].params.query).toEqual({
        limit: 20,
        branch_id: id,
        from: '2027-01-01',
        to: '2027-01-31',
      }),
    );
    view.unmount();
    client.clear();
  },
);
