import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { t } from '@pospay/i18n';
import { ScheduleSettingsPanel } from './schedule-settings-panel';
const state = vi.hoisted(() => ({
  data: {
    business_id: '01920000-0000-7000-8000-000000000101',
    max_shifts_per_day: 3,
    is_default: true,
    updated_at: null,
  } as object | undefined,
  error: null as unknown,
  save: vi.fn(),
  locale: 'en' as 'en' | 'ar',
}));
vi.mock('@/shared/locale/locale-context', () => ({ useLocale: () => state.locale }));
vi.mock('../api/use-schedule-settings', () => ({
  useScheduleSettings: () => ({
    data: state.data,
    error: state.error,
    isError: Boolean(state.error),
  }),
  useSetScheduleSettings: () => ({ mutateAsync: state.save, isPending: false, isError: false }),
}));
const scope = { companyId: 'company', businessId: 'business', branchId: 'branch', userId: 'user' };
it.each(['ar', 'en'] as const)(
  'shows the default and saves valid settings in %s',
  async (locale) => {
    state.locale = locale;
    state.save.mockReset().mockResolvedValue({});
    state.error = null;
    state.data = {
      business_id: scope.businessId,
      max_shifts_per_day: 3,
      is_default: true,
      updated_at: null,
    };
    render(<ScheduleSettingsPanel scope={scope} />);
    const input = screen.getByRole('spinbutton') as HTMLInputElement;
    expect(input.min).toBe('1');
    expect(input.max).toBe('4');
    expect(input.value).toBe('3');
    expect(screen.getByText(t(locale, 'shell.schedule_settings_default'))).toBeTruthy();
    fireEvent.change(input, { target: { value: '4' } });
    fireEvent.click(
      screen.getByRole('button', { name: t(locale, 'shell.schedule_settings_save') }),
    );
    await waitFor(() => expect(state.save).toHaveBeenCalledWith({ max_shifts_per_day: 4 }));
  },
);
it.each(['FORBIDDEN', 'NOT_FOUND'])('hides the panel when access is refused with %s', (code) => {
  state.data = undefined;
  state.error = { code };
  const view = render(<ScheduleSettingsPanel scope={scope} />);
  expect(view.container.textContent).toBe('');
});
