import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { employeeStaffAccessKey } from '../api/use-employee-staff-access';
import { EmployeeAccessSection } from './employee-access-section';

window.HTMLElement.prototype.scrollIntoView = () => undefined;

const get = vi.hoisted(() => vi.fn());
const post = vi.hoisted(() => vi.fn());
const deleteFn = vi.hoisted(() => vi.fn());
const state = vi.hoisted(() => ({
  status: 200 as number,
  body: null as unknown,
  staffAccess: true,
}));
vi.mock('@/shared/api/client', () => ({
  apiClient: () => ({ GET: get, POST: post, DELETE: deleteFn }),
}));
vi.mock('@/shared/locale/locale-context', () => ({ useLocale: () => 'en' as const }));
vi.mock('@/workspace/model/workspace-provider', () => ({
  useWorkspace: () => ({ staffAccess: state.staffAccess }),
}));

const IDS = {
  company: '01920000-0000-7000-8000-00000000000a',
  business: '01920000-0000-7000-8000-00000000000b',
  user: '01920000-0000-7000-8000-00000000000c',
  employee: '01920000-0000-7000-8000-00000000000d',
};

const PHONE = '+96551234567';
const PIN = '1234';
const BRANCH = '01920000-0000-7000-8000-000000000001';

const NONE_STATE = {
  state: 'NONE',
  role: null,
  branch_id: null,
  phone_last3: null,
  can_manage: true,
  can_cancel: false,
};

const ACTIVE_STATE = {
  state: 'ACTIVE',
  role: 'staff',
  branch_id: BRANCH,
  phone_last3: '567',
  can_manage: false,
  can_cancel: false,
};

const PENDING_STATE = {
  state: 'PENDING',
  role: 'staff',
  branch_id: BRANCH,
  phone_last3: null,
  can_manage: true,
  can_cancel: true,
};

/** كاش استعلام جديد لكل اختبار — الاختبارات اللي تفحص الكاش نفسها بتبقيه في إيدها. */
function createClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

function wrap(children: ReactNode, client = createClient()) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

function accessResponse() {
  if (state.status >= 400) {
    return {
      response: { status: state.status, ok: false },
      data: undefined,
      error: state.body,
    };
  }
  return { response: { status: 200, ok: true }, data: state.body as unknown, error: undefined };
}

/** يجهز حالة الاستعلام الجاهزة ويصيّر القسم — كل اختبار يبدأ منه. */
function mountSection(client = createClient()) {
  get.mockResolvedValue(accessResponse());
  render(
    wrap(
      <EmployeeAccessSection
        companyId={IDS.company}
        businessId={IDS.business}
        employeeId={IDS.employee}
      />,
      client,
    ),
  );
  return client;
}

/** وعد مؤجل — الطلب البطيء بيتحكم فيه الاختبار نفسه. */
function deferred(): { promise: Promise<unknown>; resolve: (value: unknown) => void } {
  let resolve: (value: unknown) => void = () => undefined;
  const promise = new Promise<unknown>((done) => {
    resolve = (value: unknown) => done(value);
  });
  return { promise, resolve };
}

/** يفتح نموذج المنح ويملؤه بهاتف ورقم سري — الت ticking يأتي بعد آخر تعديل للهاتف. */
async function openGrantForm() {
  fireEvent.click(screen.getByText('Give access'));
  const phone = await screen.findByLabelText('Her phone (canonical, with country code)');
  fireEvent.change(phone, { target: { value: PHONE } });
  fireEvent.change(screen.getByLabelText('Temporary PIN (4 digits)'), { target: { value: PIN } });
  fireEvent.click(screen.getByLabelText('I confirmed this number is hers'));
  await waitFor(() =>
    expect(
      (screen.getByLabelText('I confirmed this number is hers') as HTMLInputElement).checked,
    ).toBe(true),
  );
}

beforeEach(() => {
  get.mockReset();
  post.mockReset();
  deleteFn.mockReset();
  state.status = 200;
  state.staffAccess = true;
});

describe('the employee access section visible states', () => {
  it('AC-F1-1 shows the active state with the role and the phone last three digits only', async () => {
    state.body = {
      state: 'ACTIVE',
      role: 'staff',
      branch_id: '01920000-0000-7000-8000-000000000001',
      phone_last3: '678',
      can_manage: false,
      can_cancel: false,
    };
    mountSection();
    await waitFor(() => expect(screen.getByText('Access is active.')).toBeTruthy());
    expect(screen.getByText('Employee')).toBeTruthy();
    expect(screen.getByText('678')).toBeTruthy();
    expect(screen.queryByText('+96512345678')).toBeNull();
    expect(screen.queryByText('Give access')).toBeNull();
  });

  it('AC-F1-1 offers «Give access» only when the state says NONE and can_manage is true', async () => {
    state.body = {
      state: 'NONE',
      role: null,
      branch_id: null,
      phone_last3: null,
      can_manage: true,
      can_cancel: false,
    };
    mountSection();
    await waitFor(() => expect(screen.getByText('No access yet.')).toBeTruthy());
    fireEvent.click(screen.getByText('Give access'));
    await waitFor(() => expect(screen.getByText('I confirmed this number is hers')).toBeTruthy());
    // AC-F1-5: التأكيد الإجباري يمنع الإرسال قبل التعلّم.
    expect(screen.getByRole('alert').textContent).toBe('Tick the confirmation before saving.');
  });
});

describe('the employee access section gate and the pending record', () => {
  it('FR-F1-9 the section disappears entirely when the capability answers 503 NOT_READY', async () => {
    state.status = 503;
    state.body = { code: 'NOT_READY', message_en: 'not ready', message_ar: 'not ready' };
    get.mockResolvedValue(accessResponse());
    const { container } = render(
      wrap(
        <EmployeeAccessSection
          companyId={IDS.company}
          businessId={IDS.business}
          employeeId={IDS.employee}
        />,
      ),
    );
    await waitFor(() => expect(container.querySelector('section')).toBeNull());
  });

  it('AC-F1-6b offers the pending cancel for a PENDING record the caller may manage', async () => {
    state.body = {
      state: 'PENDING',
      role: 'reception',
      branch_id: '01920000-0000-7000-8000-000000000001',
      phone_last3: null,
      can_manage: true,
      can_cancel: true,
    };
    mountSection();
    await waitFor(() => expect(screen.getByText('Reception / cashier')).toBeTruthy());
    expect(screen.getByText('Cancel pending grant')).toBeTruthy();
  });
});

describe('the pending cancel follows the permission the server computed', () => {
  it('AC-ACT-10 hides the pending cancel when the server says the caller may not cancel', async () => {
    state.body = {
      state: 'PENDING',
      role: 'reception',
      branch_id: '01920000-0000-7000-8000-000000000001',
      phone_last3: null,
      can_manage: true,
      can_cancel: false,
    };
    mountSection();
    await waitFor(() => expect(screen.getByText('Reception / cashier')).toBeTruthy());
    expect(screen.queryByText('Cancel pending grant')).toBeNull();
    // «Give access» بتفضل موجودة: القدرة على الإعطاء مش مرتبطة بصلاحية الإلغاء.
    expect(screen.getByText('Give access')).toBeTruthy();
  });

  it('AC-ACT-10 offers the pending cancel when the server says the caller may cancel', async () => {
    state.body = {
      state: 'PENDING',
      role: 'reception',
      branch_id: '01920000-0000-7000-8000-000000000001',
      phone_last3: null,
      can_manage: false,
      can_cancel: true,
    };
    mountSection();
    await waitFor(() => expect(screen.getByText('Reception / cashier')).toBeTruthy());
    expect(screen.getByText('Cancel pending grant')).toBeTruthy();
  });
});

describe('the employee access section while the staff-access capability is off', () => {
  it('AC-ACT-17 sends no request and shows nothing', async () => {
    state.staffAccess = false;
    const { container } = render(
      wrap(
        <EmployeeAccessSection
          companyId={IDS.company}
          businessId={IDS.business}
          employeeId={IDS.employee}
        />,
      ),
    );
    await waitFor(() => expect(container.querySelector('section')).toBeNull());
    expect(get).not.toHaveBeenCalled();
  });
});

it('P1-9 other read failures show the error to the user', async () => {
  state.status = 403;
  state.body = { code: 'FORBIDDEN', message_en: 'Access refused', message_ar: 'refused' };
  mountSection();
  await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('Access refused'));
});

describe('the employee access grant keeps its secrets', () => {
  it('AC-ACT-10 keeps the phone and the PIN out of the mutation cache and the query keys', async () => {
    state.body = NONE_STATE;
    const client = mountSection();
    await waitFor(() => expect(screen.getByText('Give access')).toBeTruthy());
    await openGrantForm();
    post.mockResolvedValue({
      response: { status: 200, ok: true },
      data: ACTIVE_STATE,
      error: undefined,
    });
    fireEvent.click(screen.getByText('Grant access'));
    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByText('Access is active.')).toBeTruthy());
    const variables = client
      .getMutationCache()
      .getAll()
      .map((mutation) => JSON.stringify(mutation.state.variables ?? null))
      .join('|');
    expect(variables).not.toContain(PHONE);
    expect(variables).not.toContain(PIN);
    const keys = client
      .getQueryCache()
      .getAll()
      .map((query) => query.queryKey.join(':'))
      .join('|');
    expect(keys).not.toContain(PHONE);
    expect(keys).not.toContain(PIN);
  });

  it('AC-ACT-10 clears the phone confirmation as soon as the phone changes', async () => {
    state.body = NONE_STATE;
    mountSection();
    await waitFor(() => expect(screen.getByText('Give access')).toBeTruthy());
    fireEvent.click(screen.getByText('Give access'));
    const phone = await screen.findByLabelText('Her phone (canonical, with country code)');
    fireEvent.change(phone, { target: { value: PHONE } });
    fireEvent.click(screen.getByLabelText('I confirmed this number is hers'));
    await waitFor(() =>
      expect(
        (screen.getByLabelText('I confirmed this number is hers') as HTMLInputElement).checked,
      ).toBe(true),
    );
    fireEvent.change(phone, { target: { value: '+96551234999' } });
    await waitFor(() =>
      expect(
        (screen.getByLabelText('I confirmed this number is hers') as HTMLInputElement).checked,
      ).toBe(false),
    );
  });
});

describe('the employee access grant shows every failure', () => {
  it('AC-ACT-10 shows a grant failure that is not an envelope error', async () => {
    state.body = NONE_STATE;
    mountSection();
    await waitFor(() => expect(screen.getByText('Give access')).toBeTruthy());
    await openGrantForm();
    post.mockRejectedValue(new Error('NETWORK_DOWN'));
    fireEvent.click(screen.getByText('Grant access'));
    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
    expect(screen.getByRole('alert').textContent).toBe('Something went wrong. Try again.');
  });
});

describe('the employee access section resets the PIN of an active employee', () => {
  it('F2b-1 offers the reset button for an ACTIVE record the caller may manage', async () => {
    state.body = { ...ACTIVE_STATE, can_manage: true };
    mountSection();
    await waitFor(() => expect(screen.getByText('Access is active.')).toBeTruthy());
    expect(screen.getByText('Reset PIN')).toBeTruthy();
    // «Give access» بتفضل مقفولة على السجل النشط.
    expect(screen.queryByText('Give access')).toBeNull();
  });

  it('F2b-1 hides the reset button when the server says the caller may not manage', async () => {
    state.body = ACTIVE_STATE;
    mountSection();
    await waitFor(() => expect(screen.getByText('Access is active.')).toBeTruthy());
    expect(screen.queryByText('Reset PIN')).toBeNull();
  });

  it('F2b-1 submits the reset directly and keeps the PIN out of every cache', async () => {
    state.body = { ...ACTIVE_STATE, can_manage: true };
    const client = mountSection();
    await waitFor(() => expect(screen.getByText('Reset PIN')).toBeTruthy());
    post.mockResolvedValue({
      response: { status: 200, ok: true },
      data: { ...ACTIVE_STATE, can_manage: true },
      error: undefined,
    });
    fireEvent.click(screen.getByText('Reset PIN'));
    const pin = await screen.findByLabelText('New temporary PIN (4 digits)');
    fireEvent.change(pin, { target: { value: '4321' } });
    fireEvent.click(screen.getByText('Reset the PIN'));
    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    // النتيجة للمستخدم: رسالة نجاح ظاهرة بعد الطلب المباشر.
    await waitFor(() =>
      expect(
        screen.getByText('The PIN was reset. It is temporary and expires after 24 hours if unused.'),
      ).toBeTruthy(),
    );
    const variables = client
      .getMutationCache()
      .getAll()
      .map((mutation) => JSON.stringify(mutation.state.variables ?? null))
      .join('|');
    expect(variables).not.toContain('4321');
    const keys = client
      .getQueryCache()
      .getAll()
      .map((query) => query.queryKey.join(':'))
      .join('|');
    expect(keys).not.toContain('4321');
  });
});

describe('the committed grant and cancel survive a slow read', () => {
  it('AC-ACT-10 keeps the committed grant when a slow read lands after it', async () => {
    state.body = NONE_STATE;
    const client = mountSection();
    await waitFor(() => expect(screen.getByText('Give access')).toBeTruthy());
    const stale = accessResponse();
    const slow = deferred();
    get.mockImplementationOnce(() => slow.promise);
    void client.refetchQueries({
      queryKey: employeeStaffAccessKey(IDS.company, IDS.business, IDS.employee),
    });
    await waitFor(() => expect(get).toHaveBeenCalledTimes(2));
    await openGrantForm();
    post.mockResolvedValue({
      response: { status: 200, ok: true },
      data: ACTIVE_STATE,
      error: undefined,
    });
    fireEvent.click(screen.getByText('Grant access'));
    await waitFor(() => expect(screen.getByText('Access is active.')).toBeTruthy());
    slow.resolve(stale);
    await act(async () => {
      await slow.promise;
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(screen.getByText('Access is active.')).toBeTruthy();
    expect(screen.queryByText('No access yet.')).toBeNull();
  });

  it('AC-ACT-10 keeps the committed cancel when a slow read lands after it', async () => {
    state.body = PENDING_STATE;
    const client = mountSection();
    await waitFor(() => expect(screen.getByText('Cancel pending grant')).toBeTruthy());
    const stale = accessResponse();
    const slow = deferred();
    get.mockImplementationOnce(() => slow.promise);
    void client.refetchQueries({
      queryKey: employeeStaffAccessKey(IDS.company, IDS.business, IDS.employee),
    });
    await waitFor(() => expect(get).toHaveBeenCalledTimes(2));
    deleteFn.mockResolvedValue({
      response: { status: 200, ok: true },
      data: NONE_STATE,
      error: undefined,
    });
    fireEvent.click(screen.getByText('Cancel pending grant'));
    await waitFor(() => expect(screen.getByText('No access yet.')).toBeTruthy());
    slow.resolve(stale);
    await act(async () => {
      await slow.promise;
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(screen.getByText('No access yet.')).toBeTruthy();
    expect(screen.queryByText('Cancel pending grant')).toBeNull();
  });
});
