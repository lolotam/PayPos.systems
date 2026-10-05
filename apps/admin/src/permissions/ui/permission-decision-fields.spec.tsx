import type { PermissionOverrideInput } from '@pospay/contracts';
import { t } from '@pospay/i18n';
import { act, render, renderHook, screen } from '@testing-library/react';
import { FormProvider, useForm } from 'react-hook-form';
import { expect, it, vi } from 'vitest';
import { PermissionDecisionFields } from './permission-decision-fields';

const state = vi.hoisted(() => ({ locale: 'en' as 'en' | 'ar' }));
vi.mock('@/shared/locale/locale-context', () => ({ useLocale: () => state.locale }));

it.each(['ar', 'en'] as const)(
  'explains employee access for both salary permissions in %s',
  (locale) => {
    state.locale = locale;
    const form = renderHook(() =>
      useForm<PermissionOverrideInput>({ defaultValues: { permission_code: '', effect: 'ALLOW' } }),
    );
    render(
      <FormProvider {...form.result.current}>
        <PermissionDecisionFields
          catalog={[
            'read:salaries:business',
            'manage:salaries:business',
            'manage:employees:business',
          ]}
        />
      </FormProvider>,
    );
    expect(screen.queryByText(t(locale, 'salary.employeeAccessHint'))).toBeNull();
    for (const code of ['read:salaries:business', 'manage:salaries:business']) {
      act(() => form.result.current.setValue('permission_code', code));
      expect(screen.getByText(t(locale, 'salary.employeeAccessHint'))).toBeTruthy();
    }
    act(() => form.result.current.setValue('permission_code', 'manage:employees:business'));
    expect(screen.queryByText(t(locale, 'salary.employeeAccessHint'))).toBeNull();
  },
);
