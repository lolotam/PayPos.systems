import type { CustomerPackageListItem, RecordingContext } from '@pospay/contracts';
import { t } from '@pospay/i18n';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useEffect } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { id, response, scope } from '../model/session-recording-result.fixture';
import { useSessionRecording, type SessionRecordingController } from '../model/use-session-recording';
import { RecordServiceSessionForm } from './record-service-session-form';

const state = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock('@/shared/api/client', () => ({ apiClient: () => ({ GET: state.get, POST: state.post }) }));
vi.mock('@/shared/locale/locale-context', () => ({ useLocale: () => 'en' }));

const service = { id: id(5), name_ar: null, name_en: 'Synthetic service', price: '7.125', revision: 1 };
const performer = { id: id(6), name_ar: null, name_en: 'Synthetic performer', employee_number: 7,
  not_clocked_in_warning: false, approved_leave_warning: false };
const customer = { id: id(7), name: 'Synthetic customer', phone: '***001' };
const packageItem: CustomerPackageListItem = {
  id: id(40), provenance: 'SOLD' as const, name_en: 'Synthetic package', name_ar: null,
  expires_on: '2026-10-15', expired: false, used_up: false, price_paid: '20.000', refunded_amount: '0.000',
  components: [{
    id: id(41), service_id: service.id, position: 1, name_en: service.name_en, name_ar: null,
    sessions_total: 2, remaining: 2, used: 0, refunded: 0, next_unit_value: '10.000',
    slot_values: [{ unit_value: '10.000', free: 2, used: 0, refunded: 0 }],
  }],
};
const context = {
  generated_at: '2026-10-15T20:59:50Z', business_timezone: 'Asia/Kuwait', recorder_membership_ids: [id(8)],
  recorder_membership_id: id(8), discount_limit: { source: 'PERSON', bps: 1000 },
} satisfies RecordingContext;
const complete = { ...response, outcome: 'COMPLETE' as const, rejected_lines: [] };
let active: SessionRecordingController | null = null;

function Harness({ contextOverride = context }: { contextOverride?: RecordingContext }) {
  const recording = useSessionRecording(scope);
  useEffect(() => { active = recording; }, [recording]);
  useEffect(() => { recording.selectCustomer(customer); }, [recording.selectCustomer]);
  return <RecordServiceSessionForm scope={scope} context={contextOverride} online recording={recording}
    onRefreshScope={() => undefined} />;
}

function lineGroup() {
  return screen.getByRole('group', { name: t('en', 'serviceSessions.lineNumber').replace('{n}', '1') });
}

async function mount(contextOverride: RecordingContext = context, packages: CustomerPackageListItem[] = [packageItem]) {
  state.get.mockImplementation((path: string) =>
    Promise.resolve({
      data: String(path).endsWith('/recording-context')
        ? contextOverride
        : String(path).endsWith('/packages')
          ? { items: packages, next_cursor: null }
          : {
              items: String(path).endsWith('/performer-options') ? [performer] : [service],
              next_cursor: null,
            },
    }),
  );
  state.post.mockResolvedValue({ data: complete, response: { status: 201 } });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(<QueryClientProvider client={client}><Harness contextOverride={contextOverride} /></QueryClientProvider>);
  expect(await screen.findByText(customer.name)).toBeTruthy();
  const serviceSelect = screen.getByLabelText(t('en', 'serviceSessions.service'));
  await waitFor(() => expect(serviceSelect.querySelector(`option[value="${service.id}"]`)).toBeTruthy());
  fireEvent.change(serviceSelect, { target: { value: service.id } });
  const performerSelect = screen.getByLabelText(t('en', 'serviceSessions.performerNumber').replace('{n}', '1'));
  await waitFor(() => expect(performerSelect.querySelector(`option[value="${performer.id}"]`)).toBeTruthy());
  fireEvent.change(performerSelect, { target: { value: performer.id } });
}

afterEach(() => {
  active?.journal?.changeScope(null);
  cleanup();
  active = null;
  sessionStorage.clear();
  state.get.mockReset();
  state.post.mockReset();
  vi.restoreAllMocks();
});

it('expires the suggested package when the implied visit date crosses local midnight', async () => {
  let elapsed = 0;
  vi.spyOn(performance, 'now').mockImplementation(() => elapsed);
  await mount();
  fireEvent.click(screen.getByRole('button', { name: t('en', 'serviceSessions.fromPackage') }));
  const option = await within(lineGroup()).findByRole('radio');
  await waitFor(() => expect((option as HTMLInputElement).checked).toBe(true));
  const performerCallsBeforeTick = state.get.mock.calls.filter(([path]) =>
    String(path).endsWith('/performer-options'),
  ).length;

  elapsed = 15000;
  expect(await within(lineGroup()).findByText(t('en', 'serviceSessions.packageNoneUsable'), {}, { timeout: 4000 })).toBeTruthy();
  expect(within(lineGroup()).queryByRole('radio')).toBeNull();
  expect(await within(lineGroup()).findByText(t('en', 'serviceSessions.packageRequired'))).toBeTruthy();
  expect(
    state.get.mock.calls.filter(([path]) => String(path).endsWith('/performer-options')),
  ).toHaveLength(performerCallsBeforeTick);
});

it('uses branch_timezone rather than business_timezone to compute the package visit date (#961)', async () => {
  // 2026-10-15T20:59:50Z is 2026-10-15 in Asia/Kuwait (valid on expires_on 2026-10-15),
  // but already 2026-10-16 in Pacific/Auckland (expired).
  await mount({ ...context, branch_timezone: 'Pacific/Auckland' });
  fireEvent.click(screen.getByRole('button', { name: t('en', 'serviceSessions.fromPackage') }));

  expect(await within(lineGroup()).findByText(t('en', 'serviceSessions.packageNoneUsable'))).toBeTruthy();
  expect(within(lineGroup()).queryByRole('radio')).toBeNull();
});

it('clamps tolerated future draft time to server now before checking package expiry and sale time', async () => {
  const soldInToleranceWindow = {
    ...packageItem,
    id: id(42),
    name_en: 'Sold after server now',
    expires_on: '2026-10-16',
    sold_at: '2026-10-15T21:00:00Z',
  };
  await mount(context, [{ ...packageItem, sold_at: '2026-10-15T20:00:00Z' }, soldInToleranceWindow]);
  fireEvent.change(screen.getByLabelText(t('en', 'serviceSessions.occurredAt')), {
    target: { value: '2026-10-16T00:00:05' },
  });
  fireEvent.click(screen.getByRole('button', { name: t('en', 'serviceSessions.fromPackage') }));

  const radios = await within(lineGroup()).findAllByRole('radio');
  expect(radios).toHaveLength(1);
  expect(within(lineGroup()).getByText(packageItem.name_en)).toBeTruthy();
  expect(within(lineGroup()).queryByText(soldInToleranceWindow.name_en)).toBeNull();
  const performerCalls = state.get.mock.calls.filter(([path]) =>
    String(path).endsWith('/performer-options'),
  );
  expect(performerCalls.at(-1)?.[1]).toMatchObject({
    params: { query: { occurred_at: '2026-10-15T21:00:05.000Z' } },
  });
});

it('rechecks edited draft time against current server-anchored clock after crossing midnight', async () => {
  let elapsed = 0;
  vi.spyOn(performance, 'now').mockImplementation(() => elapsed);
  const midnightPackage: CustomerPackageListItem = {
    ...packageItem,
    id: id(43),
    name_en: 'Midnight sale package',
    expires_on: '2026-10-16',
    sold_at: '2026-10-15T21:00:00Z',
  };
  await mount(context, [midnightPackage]);
  elapsed = 15000;
  fireEvent.click(screen.getByRole('button', { name: t('en', 'serviceSessions.fromPackage') }));
  const initialOption = await within(lineGroup()).findByRole('radio', {}, { timeout: 4000 });
  await waitFor(() => expect((initialOption as HTMLInputElement).checked).toBe(true));

  fireEvent.change(screen.getByLabelText(t('en', 'serviceSessions.occurredAt')), {
    target: { value: '2026-10-16T00:00:02' },
  });
  const optionAfterEdit = within(lineGroup()).getByRole('radio') as HTMLInputElement;
  expect(optionAfterEdit.checked).toBe(true);
  expect(within(lineGroup()).getByText(midnightPackage.name_en)).toBeTruthy();
});
