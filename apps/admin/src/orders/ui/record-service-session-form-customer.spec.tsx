import type { RecordingContext } from '@pospay/contracts';
import { t } from '@pospay/i18n';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useEffect, useState } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { id, instant, response, scope } from '../model/session-recording-result.fixture';
import { emptySessionRecordingResult } from '../model/session-recording-result';
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

it.each([false, true])('hides the denied customer and refreshes access (saved visit: %s)', async (savedVisit) => {
  const refreshed = vi.fn();
  installReads();
  const reads = state.get.getMockImplementation();
  state.get.mockImplementation((path: string, init: unknown) =>
    String(path).includes('/profile')
      ? Promise.resolve({ error: { code: 'FORBIDDEN', message_ar: t('ar', 'serviceSessions.profileLoadFailed'), message_en: 'Refused' }, response: { status: 403 } })
      : (reads as (p: string, i: unknown) => unknown)(path, init),
  );
  function DenialHarness() {
    const recording = useSessionRecording(scope);
    useEffect(() => { active = recording; }, [recording]);
    const { journal, replaceResult, selectCustomer } = recording;
    useEffect(() => {
      if (!journal) return;
      if (!savedVisit) selectCustomer(customer);
      else replaceResult({ ...emptySessionRecordingResult(customer), session: complete.session, sessionId: complete.session.id });
    }, [journal, replaceResult, selectCustomer]);
    return <RecordServiceSessionForm scope={scope} context={context} online recording={recording} onRefreshScope={refreshed} />;
  }
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(<QueryClientProvider client={client}><DenialHarness /></QueryClientProvider>);
  await waitFor(() => expect(refreshed).toHaveBeenCalled());
  expect(screen.queryAllByText(customer.name)).toHaveLength(0);
  expect(screen.queryByDisplayValue(customer.name)).toBeNull();
  expect(screen.queryByRole('link', { name: t('en', 'customerPackages.open') })).toBeNull();
  if (savedVisit) {
    expect(active?.result.sessionId).toBe(complete.session.id);
    expect(active?.result.customerId).toBe(customer.id);
    expect(screen.getByRole('button', { name: t('en', 'serviceSessions.correctAndAppend') })).toBeTruthy();
  } else expect(saveButton().disabled).toBe(true);
});

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

const profileForbidden = {
  error: { code: 'FORBIDDEN', message_ar: t('ar', 'serviceSessions.profileLoadFailed'), message_en: 'Refused' },
  response: { status: 403 },
};

function installProfileDenialReads(options: { denied?: () => boolean; onProfile?: () => Promise<unknown> } = {}) {
  installReads();
  const base = state.get.getMockImplementation();
  state.get.mockImplementation((path: string, init: unknown) => {
    if (String(path).includes('/profile')) {
      if (options.onProfile) return options.onProfile();
      return Promise.resolve((options.denied?.() ?? true) ? profileForbidden : { data: { ...customer, locale: 'ar', opted_out: false, birthday: null, gender: null, email: null, notes: [] }, response: { status: 200 } });
    }
    return (base as (p: string, i: unknown) => unknown)(path, init);
  });
}

function expectCustomerHidden() {
  expect(screen.queryAllByText(customer.name)).toHaveLength(0);
  expect(screen.queryByText(customer.phone)).toBeNull();
  expect(screen.queryByDisplayValue(customer.name)).toBeNull();
  expect(screen.queryByRole('link', { name: t('en', 'customerPackages.open') })).toBeNull();
}

it('starts a new unselected visit when leaving a completed or unknown-time visit after denial (#1187)', async () => {
  installProfileDenialReads();
  let mode: 'complete' | 'unknown' = 'complete';
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  function TransitionHarness() {
    const recording = useSessionRecording(scope);
    const [online, setOnline] = useState(true);
    useEffect(() => { active = recording; }, [recording]);
    const { journal, replaceResult } = recording;
    useEffect(() => {
      if (!journal) return;
      replaceResult({
        ...emptySessionRecordingResult(customer),
        ...(mode === 'complete'
          ? { session: complete.session, sessionId: complete.session.id, feedback: { kind: 'COMPLETE' as const } }
          : { sessionId: id(12), feedback: { kind: 'PARTIAL' as const }, drafts: { lines: [] }, visitTimeUnknown: true }),
      });
    }, [journal, replaceResult]);
    return <>
      <button type="button" onClick={() => setOnline(false)}>Go offline</button>
      <RecordServiceSessionForm scope={scope} context={context} online={online} recording={recording} onRefreshScope={() => undefined} />
    </>;
  }
  const first = render(<QueryClientProvider client={client}><TransitionHarness /></QueryClientProvider>);
  await waitFor(() => expectCustomerHidden());
  fireEvent.click(screen.getByRole('button', { name: 'Go offline' }));
  fireEvent.click(screen.getByRole('button', { name: t('en', 'serviceSessions.newVisitSameCustomer') }));
  expectCustomerHidden();
  expect(active?.result.customer).toBeNull();
  first.unmount();

  mode = 'unknown';
  render(<QueryClientProvider client={client}><TransitionHarness /></QueryClientProvider>);
  await waitFor(() => expectCustomerHidden());
  fireEvent.click(screen.getByRole('button', { name: t('en', 'serviceSessions.newVisitSameCustomer') }));
  expectCustomerHidden();
  expect(active?.result.customer).toBeNull();
});

it('keeps a denied customer hidden offline and while a fresh read is pending when the first save completes (#1187)', async () => {
  let profilePhase: 'ok' | 'denied' | 'pending' = 'ok';
  let releaseSave: (value: unknown) => void = () => undefined;
  installProfileDenialReads({
    onProfile: () => (profilePhase === 'pending' ? new Promise(() => undefined)
      : Promise.resolve(profilePhase === 'denied' ? profileForbidden : { data: { ...customer, locale: 'ar', opted_out: false, birthday: null, gender: null, email: null, notes: [] }, response: { status: 200 } })),
  });
  state.post.mockImplementation((path: string) => {
    if (String(path).includes('/customers/')) return Promise.resolve({ data: { ...customer, locale: 'ar', opted_out: false } });
    return new Promise((resolve) => { releaseSave = resolve; });
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  function SaveHarness() {
    const recording = useSessionRecording(scope);
    const [online, setOnline] = useState(true);
    const [tick, setTick] = useState(0);
    useEffect(() => { active = recording; }, [recording]);
    return <>
      <button type="button" onClick={() => setOnline(false)}>Go offline</button>
      <RecordServiceSessionForm scope={scope} context={{ ...context, generated_at: `2026-10-12T10:00:0${tick}.000Z` }} online={online} recording={recording} onRefreshScope={() => setTick((n) => n + 1)} />
    </>;
  }
  render(<QueryClientProvider client={client}><SaveHarness /></QueryClientProvider>);
  await resolveCustomer();
  await chooseLine(0);
  await waitFor(() => expect(saveButton().disabled).toBe(false));
  fireEvent.click(saveButton());
  await waitFor(() => expect(state.post).toHaveBeenCalledTimes(2));
  profilePhase = 'denied';
  await act(async () => { await client.refetchQueries({ queryKey: ['session-customer-profile'] }); });
  await waitFor(() => expectCustomerHidden());
  profilePhase = 'pending';
  await act(async () => { releaseSave({ data: complete, response: { status: 201 } }); });
  await waitFor(() => expect(active?.result.sessionId).toBe(complete.session.id));
  expectCustomerHidden();
  expect(screen.getByRole('button', { name: t('en', 'serviceSessions.correctAndAppend') })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Go offline' }));
  expectCustomerHidden();
});

it('clears a denied transient customer when a frozen draft fails back to editing and permits a newly authorized selection (#1188)', async () => {
  let rejectSave!: (reason: unknown) => void;
  let profileDenied = false;
  let selectedTarget = customer;
  installReads();
  const base = state.get.getMockImplementation();
  state.get.mockImplementation((path: string, init: unknown) => {
    if (String(path).includes('/profile')) {
      return Promise.resolve(profileDenied ? profileForbidden : { data: { ...selectedTarget, locale: 'ar', opted_out: false, birthday: null, gender: null, email: null, notes: [] }, response: { status: 200 } });
    }
    return (base as (p: string, i: unknown) => unknown)(path, init);
  });
  let postCount = 0;
  state.post.mockImplementation((path: string) => {
    postCount += 1;
    if (String(path).includes('/customers/')) return Promise.resolve({ data: { ...selectedTarget, locale: 'ar', opted_out: false } });
    if (postCount <= 2) return new Promise((_resolve, reject) => { rejectSave = reject; });
    return Promise.resolve({ data: { ...complete, session: { ...complete.session, customer: { ...complete.session.customer, id: otherCustomer.id, name: otherCustomer.name, phone_masked: otherCustomer.phone } } }, response: { status: 201 } });
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  function RetryHarness() {
    const recording = useSessionRecording(scope);
    useEffect(() => { active = recording; }, [recording]);
    return <RecordServiceSessionForm scope={scope} context={context} online recording={recording} onRefreshScope={() => undefined} />;
  }
  const view = render(<QueryClientProvider client={client}><RetryHarness /></QueryClientProvider>);
  await resolveCustomer();
  await chooseLine(0);
  fireEvent.click(saveButton());
  await waitFor(() => expect(state.post).toHaveBeenCalledTimes(2));
  profileDenied = true;
  await act(async () => { await client.refetchQueries({ queryKey: ['session-customer-profile'] }); });
  await act(async () => { rejectSave({ status: 422, code: 'SESSION_TIME_TOO_OLD', message_ar: 'Old', message_en: 'Too old' }); });
  await waitFor(() => expect(active?.result.customer).toBeNull());
  expect(saveButton().disabled).toBe(true);
  const form = view.container.querySelector('form');
  if (!form) throw new Error('Missing form');
  fireEvent.submit(form);
  expect(state.post).toHaveBeenCalledTimes(2);
  profileDenied = false;
  selectedTarget = otherCustomer;
  await resolveCustomer(otherCustomer.name);
  await waitFor(() => expect(saveButton().disabled).toBe(false));
  fireEvent.click(saveButton());
  await waitFor(() => expect(active?.result.session?.customer.id).toBe(otherCustomer.id));
});
