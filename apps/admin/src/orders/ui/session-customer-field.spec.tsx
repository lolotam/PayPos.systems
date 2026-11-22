import { useEffect } from 'react';
import { t } from '@pospay/i18n';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { expect, it, vi } from 'vitest';
import { SessionCustomerField, type SessionCustomerSelection } from './session-customer-field';

const state = vi.hoisted(() => ({ post: vi.fn(), locale: 'en' as 'ar' | 'en' }));
vi.mock('@/shared/api/client', () => ({ apiClient: () => ({ POST: state.post }) }));
vi.mock('@/shared/locale/locale-context', () => ({ useLocale: () => state.locale }));
const id = '01920000-0000-7000-8000-0000000000a2';
const saved = {
  id,
  name: 'Canonical synthetic customer',
  locale: 'ar',
  opted_out: false,
  phone: '***001',
};
let selection: SessionCustomerSelection | null;
function Harness({
  disabled = false,
  companyId = 'company',
  branchId = 'branch',
  userId = 'actor',
  businessId = 'business',
  entryScope = 'branch',
  externalValue,
}: {
  externalValue?: SessionCustomerSelection | null;
  disabled?: boolean;
  companyId?: string;
  branchId?: string;
  userId?: string;
  businessId?: string;
  entryScope?: 'company' | 'business' | 'branch';
}) {
  const form = useForm<{ customer: SessionCustomerSelection | null }>({
    defaultValues: { customer: null },
  });
  const { setValue } = form;
  const watched = useWatch({ control: form.control, name: 'customer' });
  useEffect(() => {
    if (externalValue !== undefined) setValue('customer', externalValue);
  }, [externalValue, setValue]);
  useEffect(() => {
    selection = watched;
  }, [watched]);
  return (
    <form>
      <Controller
        control={form.control}
        name="customer"
        render={({ field }) => (
          <SessionCustomerField
            companyId={companyId}
            branchId={branchId}
            userId={userId}
            businessId={businessId}
            entryScope={entryScope}
            value={field.value}
            onChange={field.onChange}
            onBlur={field.onBlur}
            disabled={disabled}
          />
        )}
      />
    </form>
  );
}
function mount(disabled = false) {
  const client = new QueryClient();
  render(
    <QueryClientProvider client={client}>
      <Harness disabled={disabled} />
    </QueryClientProvider>,
  );
  return client;
}
function fill() {
  for (const [key, value] of [
    ['name', 'Entered synthetic name'],
    ['callingCode', '999'],
    ['phone', '00000001'],
  ] as const) {
    fireEvent.change(screen.getByLabelText(t(state.locale, `serviceSessions.${key}`)), {
      target: { value },
    });
  }
}
function resolve() {
  fireEvent.click(
    screen.getByRole('button', { name: t(state.locale, 'serviceSessions.findOrCreate') }),
  );
}

it.each(['ar', 'en'] as const)(
  'selects a returned customer, including opt-out, and clears raw phone in %s',
  async (locale) => {
    state.locale = locale;
    const record = {
      ...saved,
      name: locale === 'en' ? 'Entered synthetic name' : saved.name,
      opted_out: locale === 'ar',
    };
    state.post.mockResolvedValueOnce({ data: record });
    const client = mount();
    fill();
    resolve();
    expect(await screen.findByRole('status')).toBeTruthy();
    expect(selection).toEqual({ id, name: record.name, phone: record.phone });
    expect(screen.getByRole('status').textContent).toContain(saved.phone);
    expect(
      (screen.getByLabelText(t(locale, 'serviceSessions.phone')) as HTMLInputElement).value,
    ).toBe('');
    expect(
      (screen.getByLabelText(t(locale, 'serviceSessions.callingCode')) as HTMLInputElement).value,
    ).toBe('');
    expect(
      (screen.getByLabelText(t(locale, 'serviceSessions.name')) as HTMLInputElement).value,
    ).toBe(record.name);
    expect(state.post.mock.lastCall?.[1].body.locale).toBe(locale);
    await waitFor(() => expect(client.getMutationCache().getAll()).toHaveLength(0));
  },
);

it.each(['name', 'callingCode', 'phone'] as const)(
  'invalidates the RHF selection when %s changes',
  async (key) => {
    state.post.mockResolvedValueOnce({ data: saved });
    mount();
    fill();
    resolve();
    await screen.findByRole('status');
    fireEvent.change(screen.getByLabelText(t(state.locale, `serviceSessions.${key}`)), {
      target: { value: '2' },
    });
    expect(selection).toBeNull();
    expect(screen.queryByRole('status')).toBeNull();
    expect(
      (screen.getByLabelText(t(state.locale, `serviceSessions.${key}`)) as HTMLInputElement).value,
    ).toBe('2');
  },
);

it('requires valid entry and preserves it on a localized HTTP refusal', async () => {
  state.post.mockClear();
  state.locale = 'ar';
  mount();
  resolve();
  await screen.findByRole('alert');
  expect(state.post).not.toHaveBeenCalled();
  state.post.mockResolvedValueOnce({
    error: { code: 'FORBIDDEN', message_ar: 'Refusal AR', message_en: 'Refusal EN' },
    response: { status: 403 },
  });
  fill();
  resolve();
  await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('Refusal AR'));
  expect(selection).toBeNull();
  expect(state.post).toHaveBeenCalledTimes(1);
  expect((screen.getByLabelText(t('ar', 'serviceSessions.phone')) as HTMLInputElement).value).toBe(
    '00000001',
  );
});

it('disables entry while pending and does not select on a network failure', async () => {
  let reject!: (reason: Error) => void;
  state.post.mockImplementationOnce(
    () =>
      new Promise((_resolve, fail) => {
        reject = fail;
      }),
  );
  mount();
  fill();
  resolve();
  await waitFor(() => expect(screen.getByRole('button').closest('fieldset')?.disabled).toBe(true));
  await act(async () => reject(new Error('Synthetic network loss')));
  await screen.findByRole('alert');
  expect(selection).toBeNull();
});

it('supports the caller disabling find-or-create while offline', () => {
  mount(true);
  expect(screen.getByRole('button').closest('fieldset')?.disabled).toBe(true);
});
function scopedMount() {
  const client = new QueryClient();
  const host = (scope = {}) => (
    <QueryClientProvider client={client}>
      <Harness {...scope} />
    </QueryClientProvider>
  );
  const view = render(host());
  return { ...view, changeScope: (scope: object) => view.rerender(host(scope)), client };
}
it.each(['branchId', 'companyId', 'userId'] as const)(
  'drops a pending customer response and purges entry when %s changes',
  async (key) => {
    let finish!: (response: { data: typeof saved }) => void;
    state.post.mockImplementationOnce(
      () =>
        new Promise((done) => {
          finish = done;
        }),
    );
    const view = scopedMount();
    fill();
    resolve();
    await waitFor(() => expect(finish).toBeDefined());
    view.changeScope({ [key]: 'replacement' });
    for (const field of ['name', 'callingCode', 'phone'] as const) {
      expect(
        (screen.getByLabelText(t(state.locale, `serviceSessions.${field}`)) as HTMLInputElement)
          .value,
      ).toBe('');
    }
    await act(async () => {
      finish({ data: saved });
    });
    expect(selection).toBeNull();
    expect(screen.queryByRole('status')).toBeNull();
    await waitFor(() => expect(view.client.getMutationCache().getAll()).toHaveLength(0));
  },
);
it.each(['branchId', 'companyId', 'userId', 'entryScope'] as const)(
  'purges an existing customer selection when %s changes',
  async (key) => {
    state.post.mockResolvedValueOnce({ data: saved });
    const view = scopedMount();
    fill();
    resolve();
    await screen.findByRole('status');
    view.changeScope({ [key]: key === 'entryScope' ? 'company' : 'replacement' });
    expect(selection).toBeNull();
    expect(screen.queryByRole('status')).toBeNull();
    expect(
      (screen.getByLabelText(t(state.locale, 'serviceSessions.name')) as HTMLInputElement).value,
    ).toBe('');
  },
);
it('does not select a customer after the field unmounts', async () => {
  let finish!: (response: { data: typeof saved }) => void;
  state.post.mockImplementationOnce(
    () =>
      new Promise((done) => {
        finish = done;
      }),
  );
  const onChange = vi.fn();
  const view = render(
    <QueryClientProvider client={new QueryClient()}>
      <SessionCustomerField
        companyId="company"
        branchId="branch"
        userId="actor"
        value={null}
        onChange={onChange}
      />
    </QueryClientProvider>,
  );
  fill();
  resolve();
  await waitFor(() => expect(finish).toBeDefined());
  onChange.mockClear();
  view.unmount();
  await act(async () => {
    finish({ data: saved });
  });
  expect(onChange).not.toHaveBeenCalled();
});
it('offers gender with no preselection and scopes the note and its privacy hint to business entry', () => {
  state.locale = 'en';
  const view = scopedMount();
  for (const key of ['genderFemale', 'genderMale'] as const) {
    expect(
      (
        screen.getByRole('radio', {
          name: t('en', key === 'genderFemale' ? 'serviceSessions.genderFemale' : 'serviceSessions.genderMale'),
        }) as HTMLInputElement
      ).checked,
    ).toBe(false);
  }
  expect(screen.getByLabelText(t('en', 'serviceSessions.note'))).toBeTruthy();
  expect(screen.getByText(t('en', 'serviceSessions.notePrivacy'))).toBeTruthy();
  view.changeScope({ entryScope: 'company' });
  expect(screen.queryByLabelText(t('en', 'serviceSessions.note'))).toBeNull();
  expect(screen.queryByText(t('en', 'serviceSessions.notePrivacy'))).toBeNull();
});

it.each([
  ['a day without a month', { birthdayDay: '5', birthdayMonth: '', birthdayYear: '' }],
  ['a month without a day', { birthdayDay: '', birthdayMonth: '3', birthdayYear: '' }],
  ['a year alone', { birthdayDay: '', birthdayMonth: '', birthdayYear: '1990' }],
  ['the thirtieth of February', { birthdayDay: '30', birthdayMonth: '2', birthdayYear: '' }],
  ['a non-leap twenty-ninth of February', { birthdayDay: '29', birthdayMonth: '2', birthdayYear: '1900' }],
  ['a nonnumeric day', { birthdayDay: 'abc', birthdayMonth: '', birthdayYear: '' }],
  ['a fractional year', { birthdayDay: '5', birthdayMonth: '3', birthdayYear: '1990.5' }],
])('refuses %s before any request', async (_case, birth) => {
  state.post.mockClear();
  state.locale = 'en';
  mount();
  fill();
  for (const [key, value] of Object.entries(birth)) {
    const label =
      key === 'birthdayDay'
        ? 'serviceSessions.birthdayDay'
        : key === 'birthdayMonth'
          ? 'serviceSessions.birthdayMonth'
          : 'serviceSessions.birthdayYear';
    fireEvent.change(screen.getByLabelText(t('en', label)), { target: { value } });
  }
  resolve();
  await screen.findByRole('alert');
  expect(state.post).not.toHaveBeenCalled();
});

it('keeps the twenty-ninth of February with no year and never invents 2000', async () => {
  state.post.mockClear();
  state.locale = 'en';
  state.post.mockResolvedValueOnce({ data: saved });
  mount();
  fill();
  fireEvent.change(screen.getByLabelText(t('en', 'serviceSessions.birthdayDay')), {
    target: { value: '29' },
  });
  fireEvent.change(screen.getByLabelText(t('en', 'serviceSessions.birthdayMonth')), {
    target: { value: '2' },
  });
  fireEvent.click(screen.getByRole('radio', { name: t('en', 'serviceSessions.genderFemale') }));
  resolve();
  await screen.findByRole('status');
  expect(state.post.mock.lastCall?.[1].body.birthday).toEqual({ day: 29, month: 2 });
  expect(JSON.stringify(state.post.mock.lastCall?.[1].body)).not.toContain('2000');
});

it('guides the next attempt when validation fails with no gender without claiming the phone is new', async () => {
  state.post.mockClear();
  state.locale = 'en';
  mount();
  fill();
  fireEvent.change(screen.getByLabelText(t('en', 'serviceSessions.birthdayDay')), {
    target: { value: '30' },
  });
  fireEvent.change(screen.getByLabelText(t('en', 'serviceSessions.birthdayMonth')), {
    target: { value: '2' },
  });
  resolve();
  expect(await screen.findByText(t('en', 'serviceSessions.genderNeededHint'))).toBeTruthy();
  expect(state.post).not.toHaveBeenCalled();
});

it.each(['clear', 'replace', 'pending'] as const)(
  'synchronizes a parent %s without restoring an older customer',
  async (mode) => {
    const next =
      mode === 'clear'
        ? null
        : {
            id: '01920000-0000-7000-8000-0000000000a3',
            name: 'Replacement synthetic customer',
            phone: '***002',
          };
    let finish!: (response: { data: typeof saved }) => void;
    state.post.mockImplementationOnce(() =>
      mode === 'pending'
        ? new Promise((done) => {
            finish = done;
          })
        : Promise.resolve({ data: saved }),
    );
    const view = scopedMount();
    fill();
    resolve();
    if (mode === 'pending') await waitFor(() => expect(finish).toBeDefined());
    else await screen.findByRole('status');
    view.changeScope({ externalValue: next });
    if (mode === 'pending')
      await act(async () => {
        finish({ data: saved });
      });
    expect(selection).toEqual(next);
    for (const key of ['name', 'callingCode', 'phone'] as const) {
      expect(
        (screen.getByLabelText(t(state.locale, `serviceSessions.${key}`)) as HTMLInputElement)
          .value,
      ).toBe(key === 'name' ? (next?.name ?? '') : '');
    }
    const statusText = screen.queryByRole('status')?.textContent ?? '';
    if (next === null) expect(statusText).toBe('');
    else {
      expect(statusText).toContain(t(state.locale, 'serviceSessions.selected'));
      expect(statusText).toContain(next.name);
      expect(statusText).toContain(next.phone);
    }
    await waitFor(() => expect(view.client.getMutationCache().getAll()).toHaveLength(0));
  },
);
