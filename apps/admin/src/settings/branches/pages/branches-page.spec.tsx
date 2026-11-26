import { t } from '@pospay/i18n';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { BranchesPage } from './branches-page';

const api = vi.hoisted(() => ({ GET: vi.fn(), PUT: vi.fn() }));
vi.mock('@/shared/api/client', () => ({ apiClient: () => api }));
vi.mock('@/shared/locale/locale-context', () => ({ useLocale: () => 'en' }));

const id = (n: number) => `01920000-0000-7000-8000-${String(n).padStart(12, '0')}`;
const scope = { companyId: id(1), userId: id(2), businessId: id(3), branchId: id(4) };

type Hours = { weekday: number; intervals: { opens: string; closes: string }[] }[] | null;
let storedHours: Hours = null;

const branchBody = () => ({
  id: scope.branchId,
  company_id: scope.companyId,
  business_id: scope.businessId,
  name_ar: null,
  name_en: 'Main salon',
  address_ar: null,
  address_en: null,
  geo: null,
  opening_hours: storedHours,
  timezone: null,
  effective_timezone: 'Asia/Kuwait',
  is_active: true,
  created_at: '2026-11-01T08:00:00.000Z',
});

const ok = (data: unknown) => ({ data, response: { status: 200, ok: true } });
const fail = (status: number, body: object) => ({ error: body, response: { status, ok: false } });
const label = (key: Parameters<typeof t>[1]) => t('en', key);

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <BranchesPage scope={scope} />
    </QueryClientProvider>,
  );
}

const checkbox = (day: string) =>
  screen.getByRole('checkbox', {
    name: `${day}: ${label('branchHours.open')}`,
  }) as HTMLInputElement;
const timeInput = (day: string, kind: 'opens' | 'closes', n = 1) =>
  screen.getByLabelText(`${day} ${label(`branchHours.${kind}`)} ${n}`) as HTMLInputElement;
const save = () =>
  screen.getByRole('button', { name: label('branchHours.save') }) as HTMLButtonElement;

beforeEach(() => {
  api.GET.mockReset();
  api.PUT.mockReset();
  storedHours = null;
  api.GET.mockImplementation(async () => ok(branchBody()));
  api.PUT.mockImplementation(async (_path: string, options: { body: { opening_hours: Hours } }) => {
    storedHours = options.body.opening_hours;
    return ok(branchBody());
  });
});

it('shows the branch name, its time zone and every weekday closed when no hours are set', async () => {
  renderPage();
  expect(await screen.findByText('Main salon')).toBeTruthy();
  expect(
    screen.getByText(label('branchHours.timeZone').replace('{zone}', 'Asia/Kuwait')),
  ).toBeTruthy();
  expect(screen.getByText(label('branchHours.noHours'))).toBeTruthy();
  for (const day of [
    'Monday',
    'Tuesday',
    'Wednesday',
    'Thursday',
    'Friday',
    'Saturday',
    'Sunday',
  ]) {
    expect(checkbox(day).checked).toBe(false);
  }
  expect(screen.queryByRole('button', { name: label('branchHours.clear') })).toBeNull();
});

it('shows the stored hours per day, with several periods on one day', async () => {
  storedHours = [
    { weekday: 1, intervals: [{ opens: '09:00', closes: '17:00' }] },
    {
      weekday: 3,
      intervals: [
        { opens: '09:00', closes: '12:00' },
        { opens: '14:00', closes: '20:00' },
      ],
    },
  ];
  renderPage();
  await screen.findByText('Main salon');
  expect(checkbox('Monday').checked).toBe(true);
  expect(timeInput('Monday', 'opens').value).toBe('09:00');
  expect(timeInput('Monday', 'closes').value).toBe('17:00');
  expect(timeInput('Wednesday', 'opens', 2).value).toBe('14:00');
  expect(timeInput('Wednesday', 'closes', 2).value).toBe('20:00');
  expect(checkbox('Tuesday').checked).toBe(false);
  expect(save().disabled).toBe(true);
});

it('opens a day, edits its times and saves the whole week through the opening-hours route', async () => {
  renderPage();
  await screen.findByText('Main salon');
  fireEvent.click(checkbox('Tuesday'));
  fireEvent.change(timeInput('Tuesday', 'opens'), { target: { value: '10:30' } });
  fireEvent.change(timeInput('Tuesday', 'closes'), { target: { value: '22:00' } });
  expect(screen.getByText(label('branchHours.dirtyNote'))).toBeTruthy();
  fireEvent.click(save());
  expect(await screen.findByText(label('branchHours.saved'))).toBeTruthy();
  const [path, options] = api.PUT.mock.calls[0] ?? [];
  expect(path).toBe('/v1/businesses/{businessId}/branches/{branchId}/opening-hours');
  expect(options.params.path).toEqual({ businessId: scope.businessId, branchId: scope.branchId });
  expect(options.body).toEqual({
    opening_hours: [{ weekday: 2, intervals: [{ opens: '10:30', closes: '22:00' }] }],
  });
  expect(screen.queryByText(label('branchHours.dirtyNote'))).toBeNull();
});

it('adds and removes a period of a day before saving', async () => {
  renderPage();
  await screen.findByText('Main salon');
  fireEvent.click(checkbox('Friday'));
  fireEvent.click(
    screen.getByRole('button', { name: `Friday: ${label('branchHours.addInterval')}` }),
  );
  fireEvent.change(timeInput('Friday', 'opens', 1), { target: { value: '08:00' } });
  fireEvent.change(timeInput('Friday', 'closes', 1), { target: { value: '12:00' } });
  fireEvent.change(timeInput('Friday', 'opens', 2), { target: { value: '15:00' } });
  fireEvent.change(timeInput('Friday', 'closes', 2), { target: { value: '21:00' } });
  fireEvent.click(
    screen.getByRole('button', { name: `Friday: ${label('branchHours.removeInterval')} 1` }),
  );
  expect(timeInput('Friday', 'opens', 1).value).toBe('15:00');
  fireEvent.click(save());
  await screen.findByText(label('branchHours.saved'));
  expect(api.PUT.mock.calls[0]?.[1].body.opening_hours).toEqual([
    { weekday: 5, intervals: [{ opens: '15:00', closes: '21:00' }] },
  ]);
});

it('blocks saving and names the day when the opening and closing times are equal', async () => {
  renderPage();
  await screen.findByText('Main salon');
  fireEvent.click(checkbox('Monday'));
  fireEvent.change(timeInput('Monday', 'closes'), { target: { value: '09:00' } });
  expect((await screen.findByRole('alert')).textContent).toBe(
    label('branchHours.sameTimes').replace('{day}', 'Monday'),
  );
  expect(save().disabled).toBe(true);
  expect(api.PUT).not.toHaveBeenCalled();
});

it('blocks saving when two periods of a day overlap', async () => {
  renderPage();
  await screen.findByText('Main salon');
  fireEvent.click(checkbox('Monday'));
  fireEvent.click(
    screen.getByRole('button', { name: `Monday: ${label('branchHours.addInterval')}` }),
  );
  fireEvent.change(timeInput('Monday', 'opens', 1), { target: { value: '09:00' } });
  fireEvent.change(timeInput('Monday', 'closes', 1), { target: { value: '13:00' } });
  fireEvent.change(timeInput('Monday', 'opens', 2), { target: { value: '12:00' } });
  fireEvent.change(timeInput('Monday', 'closes', 2), { target: { value: '15:00' } });
  expect((await screen.findByRole('alert')).textContent).toBe(label('branchHours.overlap'));
  expect(save().disabled).toBe(true);
});

it('shows the server message when the save is refused with a validation error', async () => {
  api.PUT.mockResolvedValue(
    fail(400, {
      code: 'VALIDATION_FAILED',
      message_en: 'The request is invalid',
      message_ar: 'ar message',
    }),
  );
  renderPage();
  await screen.findByText('Main salon');
  fireEvent.click(checkbox('Sunday'));
  fireEvent.click(save());
  expect(await screen.findByText('The request is invalid')).toBeTruthy();
  expect(screen.queryByText(label('branchHours.saved'))).toBeNull();
});

it('tells the user when the user is not allowed to change the hours (403) or the branch is gone (404)', async () => {
  api.PUT.mockResolvedValueOnce(
    fail(403, { code: 'FORBIDDEN', message_en: 'Forbidden', message_ar: 'ar message' }),
  );
  renderPage();
  await screen.findByText('Main salon');
  fireEvent.click(checkbox('Sunday'));
  fireEvent.click(save());
  expect(await screen.findByText(label('branchHours.notAllowed'))).toBeTruthy();
  api.PUT.mockResolvedValueOnce(
    fail(404, { code: 'NOT_FOUND', message_en: 'Not found', message_ar: 'ar message' }),
  );
  fireEvent.click(save());
  expect(await screen.findByText(label('branchHours.notFound'))).toBeTruthy();
});

it('clears the stored hours with a null write and shows the empty state again', async () => {
  storedHours = [{ weekday: 1, intervals: [{ opens: '09:00', closes: '17:00' }] }];
  renderPage();
  await screen.findByText('Main salon');
  fireEvent.click(screen.getByRole('button', { name: label('branchHours.clear') }));
  expect(await screen.findByText(label('branchHours.cleared'))).toBeTruthy();
  expect(api.PUT.mock.calls[0]?.[1].body).toEqual({ opening_hours: null });
  expect(checkbox('Monday').checked).toBe(false);
  expect(screen.getByText(label('branchHours.noHours'))).toBeTruthy();
});

it('keeps the draft intact when clearing the hours fails', async () => {
  storedHours = [{ weekday: 1, intervals: [{ opens: '09:00', closes: '17:00' }] }];
  api.PUT.mockResolvedValueOnce(
    fail(403, { code: 'FORBIDDEN', message_en: 'Forbidden', message_ar: 'ar message' }),
  );
  renderPage();
  await screen.findByText('Main salon');
  fireEvent.click(screen.getByRole('button', { name: label('branchHours.clear') }));
  expect(await screen.findByText(label('branchHours.notAllowed'))).toBeTruthy();
  expect(checkbox('Monday').checked).toBe(true);
  expect(screen.queryByText(label('branchHours.dirtyNote'))).toBeNull();
  expect(screen.queryByText(label('branchHours.cleared'))).toBeNull();
});

it('saves an all-closed week as an empty list, which is different from no hours', async () => {
  storedHours = null;
  renderPage();
  await screen.findByText('Main salon');
  expect(save().disabled).toBe(false);
  fireEvent.click(save());
  await screen.findByText(label('branchHours.saved'));
  expect(api.PUT.mock.calls[0]?.[1].body).toEqual({ opening_hours: [] });
  await waitFor(() => expect(screen.getByText(label('branchHours.closedAllWeek'))).toBeTruthy());
});

it('shows a load failure with a retry that reads the branch again', async () => {
  api.GET.mockResolvedValueOnce(
    fail(500, { code: 'INTERNAL', message_en: 'Something broke', message_ar: 'ar message' }),
  );
  renderPage();
  const alert = await screen.findByRole('alert');
  expect(alert.textContent).toContain(label('branchHours.loadFailed'));
  fireEvent.click(screen.getByRole('button', { name: label('branchHours.retry') }));
  expect(await screen.findByText('Main salon')).toBeTruthy();
});
