import type { RecordingContext } from '@pospay/contracts';
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
const packageItem = {
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

function Harness() {
  const recording = useSessionRecording(scope);
  useEffect(() => { active = recording; }, [recording]);
  useEffect(() => { recording.selectCustomer(customer); }, [recording.selectCustomer]);
  return <RecordServiceSessionForm scope={scope} context={context} online recording={recording}
    onRefreshScope={() => undefined} />;
}

function lineGroup() {
  return screen.getByRole('group', { name: t('en', 'serviceSessions.lineNumber').replace('{n}', '1') });
}

async function mount() {
  state.get.mockImplementation((path: string) => Promise.resolve({
    data: String(path).endsWith('/recording-context') ? context
      : String(path).endsWith('/packages') ? { items: [packageItem], next_cursor: null }
        : { items: String(path).endsWith('/performer-options') ? [performer] : [service], next_cursor: null },
  }));
  state.post.mockResolvedValue({ data: complete, response: { status: 201 } });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(<QueryClientProvider client={client}><Harness /></QueryClientProvider>);
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

  elapsed = 15000;
  expect(await within(lineGroup()).findByText(t('en', 'serviceSessions.packageNoneUsable'), {}, { timeout: 4000 })).toBeTruthy();
  expect(within(lineGroup()).queryByRole('radio')).toBeNull();
  expect(await within(lineGroup()).findByText(t('en', 'serviceSessions.packageRequired'))).toBeTruthy();
});
