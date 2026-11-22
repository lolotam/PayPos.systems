import { useEffect } from 'react';
import { t } from '@pospay/i18n';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import { Controller, useForm } from 'react-hook-form';
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

function Harness({
  externalValue,
  branchId = 'branch',
}: {
  externalValue?: SessionCustomerSelection | null;
  branchId?: string;
}) {
  const form = useForm<{ customer: SessionCustomerSelection | null }>({
    defaultValues: { customer: null },
  });
  const { setValue } = form;
  useEffect(() => {
    if (externalValue !== undefined) setValue('customer', externalValue);
  }, [externalValue, setValue]);
  return (
    <form>
      <Controller
        control={form.control}
        name="customer"
        render={({ field }) => (
          <SessionCustomerField
            companyId="company"
            branchId={branchId}
            userId="actor"
            businessId="business"
            entryScope="branch"
            value={field.value}
            onChange={field.onChange}
            onBlur={field.onBlur}
          />
        )}
      />
    </form>
  );
}

function scopedMount() {
  const client = new QueryClient();
  const host = (scope: object = {}) => (
    <QueryClientProvider client={client}>
      <Harness {...scope} />
    </QueryClientProvider>
  );
  const view = render(host());
  return { ...view, changeScope: (scope: object) => view.rerender(host(scope)), client };
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

it('keeps the twenty-ninth of February with no year and never invents 2000', async () => {
  state.post.mockClear();
  state.locale = 'en';
  state.post.mockResolvedValueOnce({ data: saved });
  scopedMount();
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

it('accepts Arabic-Indic birthday digits from the Arabic keyboard', async () => {
  state.post.mockClear();
  state.locale = 'ar';
  state.post.mockResolvedValueOnce({ data: saved });
  scopedMount();
  fill();
  fireEvent.change(screen.getByLabelText(t('ar', 'serviceSessions.birthdayDay')), {
    target: { value: String.fromCodePoint(0x0662, 0x0669) },
  });
  fireEvent.change(screen.getByLabelText(t('ar', 'serviceSessions.birthdayMonth')), {
    target: { value: String.fromCodePoint(0x0662) },
  });
  fireEvent.click(screen.getByRole('radio', { name: t('ar', 'serviceSessions.genderFemale') }));
  resolve();
  await screen.findByRole('status');
  expect(state.post.mock.lastCall?.[1].body.birthday).toEqual({ day: 29, month: 2 });
});

it('shows profile guidance when only a profile field is invalid', async () => {
  state.post.mockClear();
  state.locale = 'en';
  scopedMount();
  fill();
  fireEvent.change(screen.getByLabelText(t('en', 'serviceSessions.birthdayDay')), {
    target: { value: '30' },
  });
  fireEvent.change(screen.getByLabelText(t('en', 'serviceSessions.birthdayMonth')), {
    target: { value: '2' },
  });
  resolve();
  expect(await screen.findByText(t('en', 'serviceSessions.invalidProfileFields'))).toBeTruthy();
});

it('clears every profile control when the scope changes', () => {
  state.locale = 'en';
  const view = scopedMount();
  fireEvent.click(screen.getByRole('radio', { name: t('en', 'serviceSessions.genderFemale') }));
  fireEvent.change(screen.getByLabelText(t('en', 'serviceSessions.birthdayDay')), {
    target: { value: '5' },
  });
  fireEvent.change(screen.getByLabelText(t('en', 'serviceSessions.email')), {
    target: { value: 'a@b.test' },
  });
  fireEvent.change(screen.getByLabelText(t('en', 'serviceSessions.note')), {
    target: { value: 'Synthetic note' },
  });
  view.changeScope({ branchId: 'replacement' });
  expect(
    (screen.getByRole('radio', { name: t('en', 'serviceSessions.genderFemale') }) as HTMLInputElement)
      .checked,
  ).toBe(false);
  expect((screen.getByLabelText(t('en', 'serviceSessions.birthdayDay')) as HTMLInputElement).value).toBe('');
  expect((screen.getByLabelText(t('en', 'serviceSessions.email')) as HTMLInputElement).value).toBe('');
  expect((screen.getByLabelText(t('en', 'serviceSessions.note')) as HTMLInputElement).value).toBe('');
});

it('guides the next attempt when validation fails with no gender without claiming the phone is new', async () => {
  state.post.mockClear();
  state.locale = 'en';
  scopedMount();
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
