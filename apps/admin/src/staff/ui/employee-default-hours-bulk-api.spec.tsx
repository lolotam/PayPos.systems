import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { EmployeeDefaultHoursSection } from './employee-default-hours-section';

const api = vi.hoisted(() => ({ GET: vi.fn(), PUT: vi.fn() }));
vi.mock('@/shared/api/client', () => ({ apiClient: () => api }));
vi.mock('../api/use-schedule-settings', () => ({ useScheduleWorkspaceBranches: () => [] }));
vi.mock('@/shared/locale/locale-context', () => ({ useLocale: () => 'en' }));
const id = '01920000-0000-7000-8000-0000000000a2';
const branchId = '01920000-0000-7000-8000-0000000000b2';
const range = { start: '09:00', end: '17:00', break_start: '13:00', break_end: '14:00' };
const week = Array.from({ length: 6 }, (_, day) => ({ ...range, day }));
const data = { employee_id: id, can_manage: true, branches: [
  { branch_id: branchId, linked: true, can_manage: true, shifts: week, updated_at: null },
] };
beforeEach(() => { api.GET.mockReset(); api.PUT.mockReset(); api.GET.mockResolvedValue({ data }); });

async function renderSection() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(<QueryClientProvider client={client}>
    <EmployeeDefaultHoursSection companyId={id} businessId={id} userId={id} employeeId={id} />
  </QueryClientProvider>);
  await waitFor(() => expect(screen.getByRole('button', { name: 'Same hours for all days' })).toBeTruthy());
  fireEvent.click(screen.getByRole('button', { name: 'Same hours for all days' }));
  return { client, view, panel: within(screen.getByRole('group', { name: 'Hours to copy' })) };
}

it('sends no PUT on bulk fill or a later edit; Save sends the branch week once', async () => {
  api.PUT.mockResolvedValue({ data });
  const { client, view, panel } = await renderSection();
  fireEvent.change(panel.getByLabelText('Start'), { target: { value: '10:00' } });
  fireEvent.click(panel.getByRole('button', { name: 'Apply to working days' }));
  await waitFor(() => expect(screen.queryByRole('group', { name: 'Hours to copy' })).toBeNull());
  const thursday = screen.getByRole('checkbox', { name: 'Thursday' }).closest('label')?.parentElement;
  if (!thursday) throw new Error('Missing Thursday row');
  fireEvent.change(within(thursday).getByLabelText('End'), { target: { value: '22:00' } });
  expect(api.PUT).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Save default hours' }));
  await waitFor(() => expect(api.PUT).toHaveBeenCalledTimes(1));
  expect(api.PUT).toHaveBeenCalledWith(
    '/v1/businesses/{businessId}/employees/{employeeId}/branches/{branchId}/default-shifts',
    { params: { header: { 'x-company-id': id }, path: { businessId: id, employeeId: id, branchId } },
      body: { shifts: week.map((shift) => ({ ...shift, start: '10:00', end: shift.day === 5 ? '22:00' : '17:00' })) } },
  );
  await waitFor(() => expect(screen.getByRole('status').textContent).toBe('Default hours saved'));
  view.unmount(); client.clear();
});

it.each([
  ['SCHEDULE_SHIFT_INVALID', '09:00', '02:00'],
  ['SCHEDULE_BREAK_INVALID', '14:00', '17:00'],
])('keeps the existing save path and displays %s after bulk fill', async (code, start, end) => {
  api.PUT.mockResolvedValue({ error: { code, message_en: code, message_ar: code }, response: { status: 422 } });
  const { client, view, panel } = await renderSection();
  fireEvent.change(panel.getByLabelText('Start'), { target: { value: start } });
  fireEvent.change(panel.getByLabelText('End'), { target: { value: end } });
  fireEvent.click(panel.getByRole('button', { name: 'Apply to working days' }));
  await waitFor(() => expect(screen.queryByRole('group', { name: 'Hours to copy' })).toBeNull());
  expect(api.PUT).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Save default hours' }));
  await waitFor(() => expect(screen.getByRole('alert').textContent).toBe(code));
  expect(api.PUT.mock.calls[0]?.[1].body.shifts).toEqual(week.map((shift) => ({ ...shift, start, end })));
  view.unmount(); client.clear();
});
