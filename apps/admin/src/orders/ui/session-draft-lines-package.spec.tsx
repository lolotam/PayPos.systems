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
const entitlementId = id(40);
const packageItem = {
  id: entitlementId,
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

function Harness() {
  const recording = useSessionRecording(scope);
  useEffect(() => { active = recording; }, [recording]);
  useEffect(() => { recording.selectCustomer(customer); }, [recording.selectCustomer]);
  return <RecordServiceSessionForm scope={scope} context={context} online recording={recording}
    onRefreshScope={() => undefined} />;
}

function installReads(remaining = 2, neverEnding = false) {
  const component = packageItem.components[0];
  if (!component) throw new Error('Missing package component');
  const item = { ...packageItem, components: [{ ...component, remaining }] };
  state.get.mockImplementation((path: string) => Promise.resolve({
    data: String(path).endsWith('/recording-context') ? context
      : String(path).endsWith('/packages') ? { items: [item], next_cursor: neverEnding ? 'more' : null }
        : { items: String(path).endsWith('/performer-options') ? [performer] : [service], next_cursor: null },
  }));
}

async function mount(remaining = 2, neverEnding = false) {
  installReads(remaining, neverEnding);
  state.post.mockImplementation((path: string) => Promise.resolve(String(path).includes('/customers/')
    ? { data: { id: id(42), name: 'Another synthetic customer', locale: 'ar', opted_out: false, phone: '***002' } }
    : { data: complete, response: { status: 201 } }));
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

function submittedLines() {
  const init = state.post.mock.calls[0]?.[1] as { body: { lines: Record<string, unknown>[] } } | undefined;
  if (!init) throw new Error('Missing record request');
  return init.body.lines;
}

afterEach(() => {
  active?.journal?.changeScope(null);
  cleanup();
  active = null;
  sessionStorage.clear();
  state.get.mockReset();
  state.post.mockReset();
});

it('hides paid inputs, ignores a stale invalid price and submits only the package line fields', async () => {
  await mount();
  await chooseLine(0);
  fireEvent.change(screen.getByLabelText(t('en', 'serviceSessions.price')), { target: { value: 'invalid' } });
  await selectPackage(0);
  expect(screen.queryByLabelText(t('en', 'serviceSessions.price'))).toBeNull();
  expect(screen.queryByLabelText(t('en', 'serviceSessions.discountAmount'))).toBeNull();
  fireEvent.click(saveButton());
  await waitFor(() => expect(state.post).toHaveBeenCalledTimes(1));
  expect(submittedLines()[0]).toEqual({
    service_id: service.id,
    package: { entitlement_id: entitlementId },
    performers: [{ employee_id: performer.id }],
  });
  expect(submittedLines()[0]).not.toHaveProperty('price');
  expect(submittedLines()[0]).not.toHaveProperty('discount');
  expect(submittedLines()[0]).not.toHaveProperty('discount_proposal_id');
});

it('disables the second pick of the last session while keeping the first pick valid', async () => {
  await mount(1);
  await chooseLine(0);
  await selectPackage(0);
  fireEvent.click(screen.getByRole('button', { name: t('en', 'serviceSessions.addLine') }));
  await chooseLine(1);
  fireEvent.click(packageToggle(1));
  const second = within(lineGroup(1)).getByRole('radio') as HTMLInputElement;
  await waitFor(() => expect(second.disabled).toBe(true));
  const first = within(lineGroup(0)).getByRole('radio') as HTMLInputElement;
  expect(first.checked).toBe(true);
  expect(first.disabled).toBe(false);
  expect(screen.queryByText(t('en', 'serviceSessions.packageExhausted'))).toBeNull();
});

it('resolving a different customer before the first save clears package mode on every line', async () => {
  await mount();
  await chooseLine(0);
  await selectPackage(0);
  fireEvent.click(screen.getByRole('button', { name: t('en', 'serviceSessions.addLine') }));
  await chooseLine(1);
  await selectPackage(1);
  fireEvent.change(screen.getByLabelText(t('en', 'serviceSessions.name')), { target: { value: 'Another customer' } });
  fireEvent.change(screen.getByLabelText(t('en', 'serviceSessions.callingCode')), { target: { value: '999' } });
  fireEvent.change(screen.getByLabelText(t('en', 'serviceSessions.phone')), { target: { value: '00000001' } });
  fireEvent.click(screen.getByRole('button', { name: t('en', 'serviceSessions.findOrCreate') }));
  await waitFor(() => {
    const toggles = screen.getAllByRole('button', { name: t('en', 'serviceSessions.fromPackage') });
    expect(toggles.every((toggle) => toggle.getAttribute('aria-pressed') === 'false')).toBe(true);
  });
  expect(screen.queryByRole('radiogroup', { name: t('en', 'serviceSessions.packagePicker') })).toBeNull();
});

it('keeps a paid neighbour editable and sends its paid body beside the package body', async () => {
  await mount();
  await chooseLine(0);
  await selectPackage(0);
  fireEvent.click(screen.getByRole('button', { name: t('en', 'serviceSessions.addLine') }));
  await chooseLine(1);
  expect(within(lineGroup(1)).getByLabelText(t('en', 'serviceSessions.price'))).toBeTruthy();
  expect(within(lineGroup(0)).queryByLabelText(t('en', 'serviceSessions.price'))).toBeNull();
  fireEvent.click(saveButton());
  await waitFor(() => expect(state.post).toHaveBeenCalledTimes(1));
  expect(submittedLines()).toEqual([
    { service_id: service.id, package: { entitlement_id: entitlementId }, performers: [{ employee_id: performer.id }] },
    { service_id: service.id, price: '7.125', discount: { kind: 'AMOUNT', amount: '0.000' },
      performers: [{ employee_id: performer.id }] },
  ]);
});

it('shows the truncation note at the page cap and permits a manual package pick', async () => {
  await mount(2, true);
  await chooseLine(0);
  fireEvent.click(packageToggle(0));
  await waitFor(() => {
    const reads = state.get.mock.calls.filter(([path]) => String(path).endsWith('/packages'));
    expect(reads).toHaveLength(10);
  });

  expect(await screen.findByText(t('en', 'serviceSessions.packageListTruncated'))).toBeTruthy();
  const option = within(lineGroup(0)).getByRole('radio') as HTMLInputElement;
  expect(option.checked).toBe(false);
  expect(screen.queryByText(t('en', 'serviceSessions.packageSuggested'))).toBeNull();
  fireEvent.click(option);
  expect(option.checked).toBe(true);
});
