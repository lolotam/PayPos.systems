import type { RecordingContext } from '@pospay/contracts';
import { t } from '@pospay/i18n';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useEffect, useState } from 'react';
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
  id: id(40), provenance: 'SOLD' as const, name_en: 'Synthetic package', name_ar: null,
  expires_on: '2026-12-31', expired: false, used_up: false, price_paid: '20.000', refunded_amount: '0.000',
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
const profileForbidden = {
  error: { code: 'FORBIDDEN', message_ar: t('ar', 'serviceSessions.profileLoadFailed'), message_en: 'Refused' },
  response: { status: 403 },
};
let active: SessionRecordingController | null = null;

function installProfileReads(target: () => { customer: typeof customer; denied: boolean }) {
  state.get.mockImplementation((path: string) => {
    if (String(path).includes('/profile')) {
      const current = target();
      return Promise.resolve(current.denied
        ? profileForbidden
        : { data: { ...current.customer, locale: 'ar', opted_out: false, birthday: null, gender: null, email: null, notes: [] }, response: { status: 200 } });
    }
    return Promise.resolve({
      data: String(path).endsWith('/recording-context') ? context
        : String(path).endsWith('/packages') ? { items: [packageItem], next_cursor: null }
          : { items: String(path).endsWith('/performer-options') ? [performer] : [service], next_cursor: null },
    });
  });
}

function saveButton() {
  return screen.getByRole('button', { name: t('en', 'serviceSessions.save') }) as HTMLButtonElement;
}

async function chooseLine() {
  const serviceSelect = screen.getByLabelText(t('en', 'serviceSessions.service'));
  await waitFor(() => expect(serviceSelect.querySelector(`option[value="${service.id}"]`)).toBeTruthy());
  fireEvent.change(serviceSelect, { target: { value: service.id } });
  const performerSelect = screen.getByLabelText(t('en', 'serviceSessions.performerNumber').replace('{n}', '1'));
  await waitFor(() => expect(performerSelect.querySelector(`option[value="${performer.id}"]`)).toBeTruthy());
  fireEvent.change(performerSelect, { target: { value: performer.id } });
}

async function resolveCustomer(targetName: string) {
  fireEvent.change(screen.getByLabelText(t('en', 'serviceSessions.name')), { target: { value: targetName } });
  fireEvent.change(screen.getByLabelText(t('en', 'serviceSessions.callingCode')), { target: { value: '999' } });
  fireEvent.change(screen.getByLabelText(t('en', 'serviceSessions.phone')), { target: { value: '00000001' } });
  fireEvent.click(screen.getByRole('button', { name: t('en', 'serviceSessions.findOrCreate') }));
  expect(await screen.findByText(t('en', 'serviceSessions.selected'))).toBeTruthy();
}

function RecordingHarness({ onRefreshScope = () => undefined }: { onRefreshScope?: () => void }) {
  const recording = useSessionRecording(scope);
  const [tick, setTick] = useState(0);
  useEffect(() => { active = recording; }, [recording]);
  return (
    <RecordServiceSessionForm
      scope={scope}
      context={{ ...context, generated_at: `2026-10-12T10:00:0${tick}.000Z` }}
      online
      recording={recording}
      onRefreshScope={() => {
        setTick((n) => n + 1);
        onRefreshScope();
      }}
    />
  );
}

afterEach(() => {
  active?.journal?.changeScope(null);
  cleanup();
  active = null;
  sessionStorage.clear();
  state.get.mockReset();
  state.post.mockReset();
});

it('hides cached package choices on an active saved visit when customer profile access is denied (#1187)', async () => {
  let denied = false;
  installProfileReads(() => ({ customer, denied }));
  state.post.mockImplementation((path: string) => Promise.resolve(
    String(path).includes('/customers/')
      ? { data: { ...customer, locale: 'ar', opted_out: false } }
      : { data: complete, response: { status: 201 } },
  ));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(<QueryClientProvider client={client}><RecordingHarness /></QueryClientProvider>);
  await resolveCustomer(customer.name);
  await chooseLine();
  await waitFor(() => expect(saveButton().disabled).toBe(false));
  fireEvent.click(saveButton());
  await waitFor(() => expect(active?.result.sessionId).toBe(complete.session.id));

  await chooseLine();
  fireEvent.click(screen.getByRole('button', { name: t('en', 'serviceSessions.fromPackage') }));
  await waitFor(() => expect(within(screen.getByRole('group', { name: t('en', 'serviceSessions.lineNumber').replace('{n}', '1') })).getByRole('radio')).toBeTruthy());
  expect(screen.getByRole('radiogroup', { name: t('en', 'serviceSessions.packagePicker') })).toBeTruthy();
  expect(screen.getByText(packageItem.name_en)).toBeTruthy();

  denied = true;
  await act(async () => { await client.refetchQueries({ queryKey: ['session-customer-profile'] }); });
  await waitFor(() => expect(screen.queryByRole('radiogroup', { name: t('en', 'serviceSessions.packagePicker') })).toBeNull());
  expect(screen.queryByText(packageItem.name_en)).toBeNull();
  expect(screen.getByText(t('en', 'serviceSessions.packageNoCustomer'))).toBeTruthy();
  expect(screen.queryAllByText(customer.name)).toHaveLength(0);
  expect(active?.result.customerId).toBe(customer.id);
  const appendButton = () => screen.getByRole('button', { name: t('en', 'serviceSessions.correctAndAppend') }) as HTMLButtonElement;
  expect(appendButton().disabled).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: t('en', 'serviceSessions.fromPackage') }));
  await waitFor(() => expect(appendButton().disabled).toBe(false));
});

it('clears a denied ID-only recovered draft after a definite save failure so another customer can be picked (#1188)', async () => {
  let denied = false;
  let target = customer;
  let failSave: 'network' | 'old' | 'ok' = 'network';
  installProfileReads(() => ({ customer: target, denied }));
  state.post.mockImplementation((path: string) => {
    if (String(path).includes('/customers/')) return Promise.resolve({ data: { ...target, locale: 'ar', opted_out: false } });
    if (failSave === 'network') return Promise.reject(new TypeError('Failed to fetch'));
    if (failSave === 'old') return Promise.reject({ status: 422, code: 'SESSION_TIME_TOO_OLD', message_ar: 'Old', message_en: 'Too old' });
    return Promise.resolve({ data: { ...complete, session: { ...complete.session, customer: { ...complete.session.customer, id: otherCustomer.id, name: otherCustomer.name, phone_masked: otherCustomer.phone } } }, response: { status: 201 } });
  });
  const refreshed = vi.fn();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(<QueryClientProvider client={client}><RecordingHarness onRefreshScope={refreshed} /></QueryClientProvider>);
  await resolveCustomer(customer.name);
  await chooseLine();
  await waitFor(() => expect(saveButton().disabled).toBe(false));
  fireEvent.click(saveButton());
  await waitFor(() => expect(active?.result.feedback.kind).toBe('UNRESOLVED'));

  denied = true;
  failSave = 'old';
  act(() => {
    if (!active) throw new Error('Missing recording controller');
    active.replaceResult({ ...active.result, customer: null, customerId: customer.id });
  });
  await act(async () => { await client.refetchQueries({ queryKey: ['session-customer-profile'] }); });
  await waitFor(() => expect(refreshed).toHaveBeenCalled());
  expect(active?.result.customer).toBeNull();
  expect(active?.result.customerId).toBe(customer.id);

  fireEvent.click(screen.getByRole('button', { name: t('en', 'serviceSessions.retryOriginal') }));
  await waitFor(() => expect(active?.result.customerId).toBeNull());
  expect(saveButton().disabled).toBe(true);

  denied = false;
  failSave = 'ok';
  target = otherCustomer;
  await resolveCustomer(otherCustomer.name);
  await waitFor(() => expect(saveButton().disabled).toBe(false));
  fireEvent.click(saveButton());
  await waitFor(() => expect(active?.result.session?.customer.id).toBe(otherCustomer.id));
});
