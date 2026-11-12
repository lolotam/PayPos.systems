import type { RecordingContext } from '@pospay/contracts';
import { t } from '@pospay/i18n';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useEffect } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { id, instant, response, scope } from '../model/session-recording-result.fixture';
import { useSessionRecording, type SessionRecordingController } from '../model/use-session-recording';
import { RecordServiceSessionForm } from './record-service-session-form';

const state = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock('@/shared/api/client', () => ({ apiClient: () => ({ GET: state.get, POST: state.post }) }));
vi.mock('@/shared/locale/locale-context', () => ({ useLocale: () => 'en' }));

const service = { id: id(5), name_ar: null, name_en: 'Synthetic service', price: '7.125', revision: 1 };
const performer = { id: id(6), name_ar: null, name_en: 'Synthetic performer', employee_number: 7,
  not_clocked_in_warning: false, approved_leave_warning: false };
const customer = { id: id(7), name: 'Synthetic customer', phone: '***001' };
const otherCustomer = { id: id(42), name: 'Other synthetic customer', phone: '***002' };
const packageItem = {
  id: id(40),
  provenance: 'SOLD' as const,
  name_en: 'Synthetic package',
  name_ar: null,
  expires_on: '2026-12-31',
  expired: false,
  used_up: false,
  price_paid: '20.000',
  refunded_amount: '0.000',
  components: [{
    id: id(41), service_id: service.id, position: 1, name_en: service.name_en, name_ar: null,
    sessions_total: 2, remaining: 2, used: 0, refunded: 0, next_unit_value: '10.000',
    slot_values: [{ unit_value: '10.000', free: 2, used: 0, refunded: 0 }],
  }],
};
const context = {
  generated_at: instant, business_timezone: 'Asia/Kuwait', recorder_membership_ids: [id(8)],
  recorder_membership_id: id(8), discount_limit: { source: 'PERSON', bps: 1000 },
} satisfies RecordingContext;
const complete = { ...response, outcome: 'COMPLETE' as const, rejected_lines: [] };
let active: SessionRecordingController | null = null;
let resolvedCustomerId = customer.id;

function Harness() {
  const recording = useSessionRecording(scope);
  useEffect(() => { active = recording; }, [recording]);
  useEffect(() => { recording.selectCustomer(customer); }, [recording.selectCustomer]);
  return <RecordServiceSessionForm scope={scope} context={context} online recording={recording}
    onRefreshScope={() => undefined} />;
}

function installReads() {
  state.get.mockImplementation((path: string) => Promise.resolve({
    data: String(path).endsWith('/recording-context') ? context
      : String(path).endsWith('/packages') ? { items: [packageItem], next_cursor: null }
        : { items: String(path).endsWith('/performer-options') ? [performer] : [service], next_cursor: null },
  }));
}

async function mount(resolvedId = customer.id) {
  resolvedCustomerId = resolvedId;
  installReads();
  state.post.mockImplementation((path: string) => {
    if (!String(path).includes('/customers/')) return Promise.resolve({ data: complete, response: { status: 201 } });
    const selected = resolvedCustomerId === customer.id ? customer : otherCustomer;
    return Promise.resolve({ data: { ...selected, locale: 'ar', opted_out: false } });
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(<QueryClientProvider client={client}><Harness /></QueryClientProvider>);
  await screen.findByText(customer.name);
  await waitFor(() => expect(saveButton().disabled).toBe(false));
}

function at<T>(items: T[], index: number): T {
  const value = items[index];
  if (value === undefined) throw new Error('Missing fixture row');
  return value;
}

function saveButton() {
  return screen.getByRole('button', { name: t('en', 'serviceSessions.save') }) as HTMLButtonElement;
}

function lineGroup(index: number) {
  return screen.getByRole('group', { name: t('en', 'serviceSessions.lineNumber').replace('{n}', String(index + 1)) });
}

function packageToggle(index: number) {
  return at(screen.getAllByRole('button', { name: t('en', 'serviceSessions.fromPackage') }), index);
}

async function chooseLine(index: number) {
  const serviceSelect = at(screen.getAllByLabelText(t('en', 'serviceSessions.service')), index);
  await waitFor(() => expect(serviceSelect.querySelector(`option[value="${service.id}"]`)).toBeTruthy());
  fireEvent.change(serviceSelect, { target: { value: service.id } });
  const performerSelect = at(screen.getAllByLabelText(t('en', 'serviceSessions.performerNumber').replace('{n}', '1')), index);
  await waitFor(() => expect(performerSelect.querySelector(`option[value="${performer.id}"]`)).toBeTruthy());
  fireEvent.change(performerSelect, { target: { value: performer.id } });
}

async function selectPackage(index: number) {
  fireEvent.click(packageToggle(index));
  await waitFor(() => expect((within(lineGroup(index)).getByRole('radio') as HTMLInputElement).checked).toBe(true));
}

function fillCustomer(name: string) {
  const entries = [['name', name], ['callingCode', '999'], ['phone', '00000001']] as const;
  for (const [key, value] of entries) {
    fireEvent.change(screen.getByLabelText(t('en', `serviceSessions.${key}`)), { target: { value } });
  }
}

async function resolveCustomer(name = customer.name) {
  fillCustomer(name);
  expect(screen.queryByText(t('en', 'serviceSessions.selected'))).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: t('en', 'serviceSessions.findOrCreate') }));
  expect(await screen.findByText(t('en', 'serviceSessions.selected'))).toBeTruthy();
}

async function expectAllToggles(pressed: boolean) {
  await waitFor(() => {
    const toggles = screen.getAllByRole('button', { name: t('en', 'serviceSessions.fromPackage') });
    expect(toggles.length).toBeGreaterThan(0);
    expect(toggles.every((toggle) => toggle.getAttribute('aria-pressed') === String(pressed))).toBe(true);
  });
}

afterEach(() => {
  active?.journal?.changeScope(null);
  cleanup();
  active = null;
  sessionStorage.clear();
  state.get.mockReset();
  state.post.mockReset();
});

it('keeps package mode while typing and after resolving the same customer', async () => {
  await mount();
  await chooseLine(0);
  await selectPackage(0);
  fireEvent.change(screen.getByLabelText(t('en', 'serviceSessions.name')), { target: { value: 'Edited synthetic name' } });
  expect(packageToggle(0).getAttribute('aria-pressed')).toBe('true');
  expect(screen.queryByText(t('en', 'serviceSessions.selected'))).toBeNull();

  await resolveCustomer();
  expect(packageToggle(0).getAttribute('aria-pressed')).toBe('true');
  expect((within(lineGroup(0)).getByRole('radio') as HTMLInputElement).checked).toBe(true);
  expect(screen.queryByText(t('en', 'serviceSessions.packageNoCustomer'))).toBeNull();
});

it('clears package mode after resolving a different customer', async () => {
  await mount(otherCustomer.id);
  await chooseLine(0);
  await selectPackage(0);

  await resolveCustomer(otherCustomer.name);
  await expectAllToggles(false);
  expect(screen.queryByRole('radiogroup', { name: t('en', 'serviceSessions.packagePicker') })).toBeNull();
});

it('preserves two package lines for the same customer and clears both for a different customer', async () => {
  await mount();
  await chooseLine(0);
  await selectPackage(0);
  fireEvent.click(screen.getByRole('button', { name: t('en', 'serviceSessions.addLine') }));
  await chooseLine(1);
  await selectPackage(1);

  await resolveCustomer();
  await expectAllToggles(true);
  expect((within(lineGroup(0)).getByRole('radio') as HTMLInputElement).checked).toBe(true);
  expect((within(lineGroup(1)).getByRole('radio') as HTMLInputElement).checked).toBe(true);
  resolvedCustomerId = otherCustomer.id;
  await resolveCustomer(otherCustomer.name);
  await expectAllToggles(false);
  expect(screen.queryByRole('radiogroup', { name: t('en', 'serviceSessions.packagePicker') })).toBeNull();
});
