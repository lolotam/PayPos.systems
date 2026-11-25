import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EmployeeAccessSection } from './employee-access-section';

window.HTMLElement.prototype.scrollIntoView = () => undefined;

const get = vi.hoisted(() => vi.fn());
const put = vi.hoisted(() => vi.fn());
const del = vi.hoisted(() => vi.fn());
const state = vi.hoisted(() => ({ body: null as unknown }));
vi.mock('@/shared/api/client', () => ({ apiClient: () => ({ GET: get, PUT: put, DELETE: del }) }));
vi.mock('@/shared/locale/locale-context', () => ({ useLocale: () => 'en' as const }));
vi.mock('@/workspace/model/workspace-provider', () => ({
  useWorkspace: () => ({ staffAccess: true }),
}));

const IDS = {
  company: '01920000-0000-7000-8000-00000000000a',
  business: '01920000-0000-7000-8000-00000000000b',
  employee: '01920000-0000-7000-8000-00000000000d',
};
const BRANCH = '01920000-0000-7000-8000-000000000001';
const NEW_PHONE = '+96551234999';
const NEW_PIN = '4321';

const ACTIVE = {
  state: 'ACTIVE',
  role: 'staff',
  branch_id: BRANCH,
  phone_last3: '567',
  can_manage: true,
  can_cancel: false,
};
const PHONE_LABEL = 'Her new phone (canonical, with country code)';
const PIN_LABEL = 'New temporary PIN (4 digits)';
const CONFIRM_LABEL = 'I confirmed this number is hers';

function mountSection() {
  get.mockResolvedValue({ response: { status: 200, ok: true }, data: state.body, error: undefined });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <EmployeeAccessSection
        companyId={IDS.company}
        businessId={IDS.business}
        employeeId={IDS.employee}
      />
    </QueryClientProvider>,
  );
  return client;
}

/** يفتح نموذج التغيير من الزر ويرجّع حقوله. */
async function openForm() {
  await waitFor(() => expect(screen.getByText('Change phone')).toBeTruthy());
  fireEvent.click(screen.getByText('Change phone'));
  const phone = await screen.findByLabelText(PHONE_LABEL);
  return { phone, pin: screen.getByLabelText(PIN_LABEL), confirm: screen.getByLabelText(CONFIRM_LABEL) };
}

const checked = (box: HTMLElement) => (box as HTMLInputElement).checked;

/** كل ما في كاش الـ mutations والـ queries كنص — لإثبات إن الهاتف والرقم السري ما اتخزنوش. */
function cacheText(client: QueryClient): { variables: string; keys: string } {
  return {
    variables: client
      .getMutationCache()
      .getAll()
      .map((mutation) => JSON.stringify(mutation.state.variables ?? null))
      .join('|'),
    keys: client
      .getQueryCache()
      .getAll()
      .map((query) => query.queryKey.join(':'))
      .join('|'),
  };
}

beforeEach(() => {
  get.mockReset();
  put.mockReset();
  del.mockReset();
  state.body = ACTIVE;
});

describe('F3-1 the change phone button follows the server state', () => {
  it('offers «Change phone» for an ACTIVE record the caller may manage', async () => {
    mountSection();
    await waitFor(() => expect(screen.getByText('Access is active.')).toBeTruthy());
    expect(screen.getByText('Change phone')).toBeTruthy();
  });

  it('hides «Change phone» when the server says the caller may not manage', async () => {
    state.body = { ...ACTIVE, can_manage: false };
    mountSection();
    await waitFor(() => expect(screen.getByText('Access is active.')).toBeTruthy());
    expect(screen.queryByText('Change phone')).toBeNull();
  });

  it('hides «Change phone» for a record that is not ACTIVE', async () => {
    state.body = { ...ACTIVE, state: 'PENDING', can_cancel: true };
    mountSection();
    await waitFor(() => expect(screen.getByText(/Access pending/)).toBeTruthy());
    expect(screen.queryByText('Change phone')).toBeNull();
  });
});

describe('F3-1 the form refuses what the contract refuses', () => {
  it('shows the confirmation message and sends nothing until the number is confirmed', async () => {
    mountSection();
    const { phone, pin } = await openForm();
    fireEvent.change(phone, { target: { value: NEW_PHONE } });
    fireEvent.change(pin, { target: { value: NEW_PIN } });
    fireEvent.click(screen.getByText('Change the phone'));
    await waitFor(() =>
      expect(screen.getByText('Tick the confirmation before saving.')).toBeTruthy(),
    );
    expect(put).not.toHaveBeenCalled();
  });

  it('shows the PIN rule and sends nothing for a PIN that is not four digits', async () => {
    mountSection();
    const { phone, pin, confirm } = await openForm();
    fireEvent.change(phone, { target: { value: NEW_PHONE } });
    fireEvent.click(confirm);
    fireEvent.change(pin, { target: { value: '12' } });
    await waitFor(() => expect(checked(confirm)).toBe(true));
    fireEvent.click(screen.getByText('Change the phone'));
    await waitFor(() => expect(screen.getByText('The PIN is exactly four digits.')).toBeTruthy());
    expect(put).not.toHaveBeenCalled();
  });

  it('clears the confirmation as soon as the phone is edited', async () => {
    mountSection();
    const { phone, confirm } = await openForm();
    fireEvent.change(phone, { target: { value: NEW_PHONE } });
    fireEvent.click(confirm);
    await waitFor(() => expect(checked(confirm)).toBe(true));
    fireEvent.change(phone, { target: { value: '+96551234888' } });
    await waitFor(() => expect(checked(confirm)).toBe(false));
  });
});

describe('F3-1 the change is a direct call that keeps its secrets', () => {
  it('shows the committed state and keeps the phone and the PIN out of every cache', async () => {
    const client = mountSection();
    const { phone, pin, confirm } = await openForm();
    put.mockResolvedValue({
      response: { status: 200, ok: true },
      data: { ...ACTIVE, phone_last3: '999' },
      error: undefined,
    });
    fireEvent.change(phone, { target: { value: NEW_PHONE } });
    fireEvent.change(pin, { target: { value: NEW_PIN } });
    fireEvent.click(confirm);
    await waitFor(() => expect(checked(confirm)).toBe(true));
    fireEvent.click(screen.getByText('Change the phone'));
    await waitFor(() => expect(put).toHaveBeenCalledTimes(1));
    expect(put.mock.calls[0]?.[1]).toMatchObject({
      params: { header: { 'x-company-id': IDS.company }, path: { employeeId: IDS.employee } },
      body: { phone: NEW_PHONE, phone_confirmed: true, pin: NEW_PIN },
    });
    await waitFor(() =>
      expect(screen.getByText(/The phone was changed\./)).toBeTruthy(),
    );
    fireEvent.click(screen.getByText('Close'));
    // الحالة الملتزمة هي اللي بتظهر بعد الإغلاق: آخر ثلاثة أرقام الجديدة بس.
    await waitFor(() => expect(screen.getByText('999')).toBeTruthy());
    expect(screen.queryByText('567')).toBeNull();
    expect(screen.queryByText(NEW_PHONE)).toBeNull();
    const { variables, keys } = cacheText(client);
    for (const secret of [NEW_PHONE, NEW_PIN]) {
      expect(variables).not.toContain(secret);
      expect(keys).not.toContain(secret);
    }
  });

  it('shows the refusal for a phone owned by another account and keeps the form open', async () => {
    mountSection();
    const { phone, pin, confirm } = await openForm();
    put.mockResolvedValue({
      response: { status: 409, ok: false },
      data: undefined,
      error: {
        code: 'STAFF_ACCESS_PHONE_TAKEN',
        message_en: 'This phone number belongs to another account. Check the number or ask the employee.',
        message_ar: 'x',
      },
    });
    fireEvent.change(phone, { target: { value: NEW_PHONE } });
    fireEvent.change(pin, { target: { value: NEW_PIN } });
    fireEvent.click(confirm);
    await waitFor(() => expect(checked(confirm)).toBe(true));
    fireEvent.click(screen.getByText('Change the phone'));
    await waitFor(() =>
      expect(
        screen.getByText(
          'This phone number belongs to another account. Check the number or ask the employee.',
        ),
      ).toBeTruthy(),
    );
    expect(screen.queryByText(/The phone was changed\./)).toBeNull();
    expect(screen.getByLabelText(PHONE_LABEL)).toBeTruthy();
  });
});

describe('F3-2 the stop access button follows the server state', () => {
  it('offers «Stop access» for an ACTIVE record the caller may manage', async () => {
    mountSection();
    await waitFor(() => expect(screen.getByText('Access is active.')).toBeTruthy());
    expect(screen.getByText('Stop access')).toBeTruthy();
  });

  it('hides «Stop access» when the server says the caller may not manage', async () => {
    state.body = { ...ACTIVE, can_manage: false };
    mountSection();
    await waitFor(() => expect(screen.getByText('Access is active.')).toBeTruthy());
    expect(screen.queryByText('Stop access')).toBeNull();
  });

  it.each(['PENDING', 'STOPPED', 'NONE'])('hides «Stop access» for a %s record', async (value) => {
    state.body = { ...ACTIVE, state: value, can_cancel: value === 'PENDING' };
    mountSection();
    await waitFor(() => expect(screen.getByText(/Access|No access/)).toBeTruthy());
    expect(screen.queryByText('Stop access')).toBeNull();
  });
});

describe('F3-2 stopping access is one direct call that replaces the screen state', () => {
  it('calls DELETE once and shows the stopped state with the give-access button instead of the active actions', async () => {
    mountSection();
    await waitFor(() => expect(screen.getByText('Stop access')).toBeTruthy());
    del.mockResolvedValue({
      response: { status: 200, ok: true },
      data: { ...ACTIVE, state: 'STOPPED', phone_last3: null },
      error: undefined,
    });
    fireEvent.click(screen.getByText('Stop access'));
    await waitFor(() => expect(screen.getByText('Access is stopped.')).toBeTruthy());
    expect(del).toHaveBeenCalledTimes(1);
    expect(del.mock.calls[0]?.[1]).toMatchObject({
      params: {
        header: { 'x-company-id': IDS.company },
        path: { businessId: IDS.business, employeeId: IDS.employee },
      },
    });
    expect(screen.queryByText('Stop access')).toBeNull();
    expect(screen.queryByText('Change phone')).toBeNull();
    expect(screen.getByText('Give access')).toBeTruthy();
  });

  it('shows the refusal under the button and keeps the active actions when the stop fails', async () => {
    mountSection();
    await waitFor(() => expect(screen.getByText('Stop access')).toBeTruthy());
    del.mockResolvedValue({
      response: { status: 403, ok: false },
      data: undefined,
      error: {
        code: 'STAFF_ACCESS_NOT_ALLOWED',
        message_en: 'You cannot manage access for this employee.',
        message_ar: 'x',
      },
    });
    fireEvent.click(screen.getByText('Stop access'));
    await waitFor(() =>
      expect(screen.getByText('You cannot manage access for this employee.')).toBeTruthy(),
    );
    expect(screen.getByText('Access is active.')).toBeTruthy();
    expect(screen.getByText('Stop access')).toBeTruthy();
  });
});
