import { formatInstant, serviceSessionErrors, t } from '@pospay/i18n';
import type { RecordingContext } from '@pospay/contracts';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useEffect } from 'react';
import { FormProvider, useForm } from 'react-hook-form';
import { afterEach, expect, it, vi } from 'vitest';
import type { SessionDraftForm } from '../model/session-drafts';
import { SessionTimeField } from './session-time-field';
const state = vi.hoisted(() => ({ locale: 'en' as 'ar' | 'en' }));
vi.mock('@/shared/locale/locale-context', () => ({ useLocale: () => state.locale }));
const context: RecordingContext = { generated_at: '2026-10-15T08:00:00.000Z', business_timezone: 'Asia/Kuwait',
  recorder_membership_ids: ['membership'], recorder_membership_id: 'membership', discount_limit: { source: 'OWNER', bps: null } };
let form: ReturnType<typeof useForm<SessionDraftForm>>;
function Harness({ zone = context.business_timezone, disabled = false, save = vi.fn() }: { zone?: string; disabled?: boolean; save?: (body: string) => void }) {
  const methods = useForm<SessionDraftForm>({ defaultValues: { lines: [] } });
  useEffect(() => { form = methods; }, [methods]);
  return <FormProvider {...methods}><form onSubmit={methods.handleSubmit((body) => save(JSON.stringify(body)))}>
    <SessionTimeField context={{ ...context, business_timezone: zone }} disabled={disabled} />
    <button type="submit">Submit fixture</button>
  </form></FormProvider>;
}
const input = () => screen.getByLabelText(t(state.locale, 'serviceSessions.occurredAt')) as HTMLInputElement;
const edit = (value: string) => fireEvent.change(input(), { target: { value } });
afterEach(() => vi.useRealTimers());
it.each(['ar', 'en'] as const)('keeps now omitted while the server-anchored label ticks in %s', async (locale) => {
  state.locale = locale; vi.useFakeTimers(); vi.setSystemTime(new Date('2040-01-01T00:00:00Z'));
  const save = vi.fn(); render(<Harness save={save} />);
  expect(input().value).toBe(''); expect(screen.getByText('Asia/Kuwait')).toBeTruthy();
  const frozen = JSON.stringify(form.getValues());
  await act(async () => vi.advanceTimersByTime(3000));
  expect(screen.getByText(formatInstant(new Date('2026-10-15T08:00:03Z'), locale, 'Asia/Kuwait'))).toBeTruthy();
  expect(JSON.stringify(form.getValues())).toBe(frozen); expect(form.formState.isDirty).toBe(false);
  await act(async () => fireEvent.click(screen.getByText('Submit fixture')));
  expect(JSON.parse(save.mock.calls[0]?.[0] ?? '{}')).not.toHaveProperty('occurred_at');
  expect(screen.getByText(t(locale, 'serviceSessions.windowHelp').replace('{oldest}', '2026-09-01 00:00:00'))).toBeTruthy();
});
it('sends fixed UTC at the inclusive oldest instant, preserves replay input, and restores omission', async () => {
  state.locale = 'en'; const save = vi.fn(), view = render(<Harness save={save} />);
  edit('2026-09-01T00:00'); fireEvent.click(screen.getByText('Submit fixture'));
  await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
  expect(JSON.parse(save.mock.calls[0]?.[0] ?? '{}').occurred_at).toBe('2026-08-31T21:00:00.000Z');
  const frozen = save.mock.calls[0]?.[0]; view.rerender(<Harness save={save} disabled />);
  expect(input().closest('fieldset')?.disabled).toBe(true); expect(JSON.stringify(form.getValues())).toBe(frozen);
  view.rerender(<Harness save={save} />); fireEvent.click(screen.getByText(t('en', 'serviceSessions.useNow')));
  expect(input().value).toBe(''); expect(JSON.parse(JSON.stringify(form.getValues()))).not.toHaveProperty('occurred_at');
});
it.each([
  ['2026-03-08T02:30', 'nonexistentTime'], ['2026-11-01T01:30', 'ambiguousTime'],
] as const)('blocks %s with an explicit DST error until corrected', async (local, error) => {
  state.locale = 'en'; const save = vi.fn(); render(<Harness zone="America/New_York" save={save} />);
  edit(local); expect(screen.getByRole('alert').textContent).toBe(t('en', `serviceSessions.${error}`));
  await act(async () => fireEvent.click(screen.getByText('Submit fixture'))); expect(save).not.toHaveBeenCalled();
  expect(input().getAttribute('aria-invalid')).toBe('true');
  edit('2026-11-01T03:30'); fireEvent.click(screen.getByText('Submit fixture'));
  await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
  expect(JSON.parse(save.mock.calls[0]?.[0] ?? '{}').occurred_at).toBe('2026-11-01T08:30:00.000Z');
});
it('leaves future/window checks to the server and displays its localized time error', async () => {
  state.locale = 'en'; const save = vi.fn(); render(<Harness save={save} />);
  edit('2026-10-15T11:02:01'); fireEvent.click(screen.getByText('Submit fixture'));
  await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
  expect(JSON.parse(save.mock.calls[0]?.[0] ?? '{}').occurred_at).toBe('2026-10-15T08:02:01.000Z');
  await act(async () => form.setError('occurred_at', { type: 'server', message: serviceSessionErrors.SESSION_TIME_IN_FUTURE.message_en }));
  expect(screen.getByRole('alert').textContent).toBe(serviceSessionErrors.SESSION_TIME_IN_FUTURE.message_en);
  expect(input().getAttribute('aria-describedby')).toContain('-error');
});
