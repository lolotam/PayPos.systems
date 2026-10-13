import { t } from '@pospay/i18n';
import type { RecordingDiscountLimit } from '@pospay/contracts';
import { useEffect } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { FormProvider, useForm, useWatch } from 'react-hook-form';
import { expect, it, vi } from 'vitest';
import { createSessionDraft, selectSessionService, type SessionDraftForm } from '../model/session-drafts';
import { SessionDiscountField } from './session-discount-field';
import { SessionDraftSummary } from './session-draft-summary';
const state = vi.hoisted(() => ({ locale: 'en' as 'ar' | 'en' }));
vi.mock('@/shared/locale/locale-context', () => ({ useLocale: () => state.locale }));
let current: SessionDraftForm['lines'];
function Harness({ prices, limit = null, onSubmit = vi.fn() }: { prices: string[]; limit?: RecordingDiscountLimit | null; onSubmit?: () => void }) {
  const service = { id: '01920000-0000-7000-8000-0000000000a1', name_ar: null, name_en: 'Synthetic service', price: '7.125', revision: 1 };
  const form = useForm<SessionDraftForm>({ defaultValues: { lines: prices.map((price, index) => ({ ...selectSessionService(createSessionDraft(String(index)), service), price })) }, mode: 'onBlur' });
  const lines = useWatch({ control: form.control, name: 'lines' });
  useEffect(() => { current = lines; }, [lines]);
  return <FormProvider {...form}><form onSubmit={form.handleSubmit(onSubmit)}>{lines.map((row, index) => <SessionDiscountField key={row.local_id} index={index} />)}
    <SessionDraftSummary limit={limit} /><input aria-label="Saved fixture" readOnly value="25.000" /><button type="submit">Submit fixture</button>
  </form></FormProvider>;
}
function change(label: string, value: string) { fireEvent.change(screen.getByLabelText(label), { target: { value } }); }
function at(items: HTMLElement[], index: number) { const value = items[index]; if (!value) throw new Error('Missing fixture field'); return value; }
it.each(['ar', 'en'] as const)('preserves both mode entries and half-up money in %s', (locale) => {
  state.locale = locale; render(<Harness prices={['7.125']} />);
  const amount = t(locale, 'serviceSessions.discountAmount'), percent = t(locale, 'serviceSessions.discountPercent');
  expect((screen.getByLabelText(amount) as HTMLInputElement).value).toBe('0.000');
  change(amount, '1.25'); fireEvent.blur(screen.getByLabelText(amount));
  fireEvent.click(screen.getByRole('button', { name: percent })); change(percent, locale === 'ar' ? String.fromCharCode(0x661, 0x660) : '10');
  expect(screen.getByText('0.713')).toBeTruthy(); expect(screen.getAllByText('6.412')).toHaveLength(2);
  expect(screen.getByRole('status').tagName).toBe('P'); fireEvent.blur(screen.getByLabelText(percent));
  fireEvent.click(screen.getByRole('button', { name: amount }));
  expect((screen.getByLabelText(amount) as HTMLInputElement).value).toBe('1.250');
  fireEvent.click(screen.getByRole('button', { name: percent }));
  expect((screen.getByLabelText(percent) as HTMLInputElement).value).toBe('10');
  expect(current[0]).toMatchObject({ discount_kind: 'PERCENT', discount_amount: '1.250', discount_percentage: '10' });
});
it('writes ordinary percent drafts only, retaining amount entries and allowing an over-limit mixed request', () => {
  state.locale = 'en'; render(<Harness prices={['7.125', '25.000']} limit={{ source: 'PERSON', bps: 1000 }} />);
  fireEvent.click(at(screen.getAllByRole('button', { name: t('en', 'serviceSessions.discountPercent') }), 0));
  change(t('en', 'serviceSessions.discountPercent'), '10');
  fireEvent.click(screen.getByRole('button', { name: t('en', 'serviceSessions.samePercent') }));
  expect(current.map((row) => [row.discount_kind, row.discount_percentage, row.discount_amount])).toEqual([['PERCENT', '10', '0.000'], ['PERCENT', '10', '0.000']]);
  expect(screen.getByText('28.912')).toBeTruthy(); expect((screen.getByLabelText('Saved fixture') as HTMLInputElement).value).toBe('25.000');
  fireEvent.change(at(screen.getAllByLabelText(t('en', 'serviceSessions.discountPercent')), 1), { target: { value: '0' } });
  expect(current[1]?.discount_percentage).toBe('0'); expect(screen.getByText('31.412')).toBeTruthy();
  expect((screen.getByRole('button', { name: 'Submit fixture' }) as HTMLButtonElement).disabled).toBe(false);
});
it('retains a lowered entered price and zero discount while showing the server-provided zero limit', () => {
  state.locale = 'en'; render(<Harness prices={['6.000']} limit={{ source: 'NOT_CONFIGURED', bps: 0 }} />);
  expect(current[0]).toMatchObject({ price: '6.000', discount_amount: '0.000' });
  expect(screen.getAllByText('6.000')).toHaveLength(3); expect(screen.getByText(t('en', 'serviceSessions.notConfigured'))).toBeTruthy();
});
it.each(['-1', '100.01', '1.001', 'unfinished'])('keeps invalid percent %s without conversion or clamping', async (value) => {
  state.locale = 'en'; render(<Harness prices={['7.125']} />);
  fireEvent.click(screen.getByRole('button', { name: t('en', 'serviceSessions.discountPercent') }));
  change(t('en', 'serviceSessions.discountPercent'), value); fireEvent.blur(screen.getByLabelText(t('en', 'serviceSessions.discountPercent')));
  expect(await screen.findByRole('alert')).toBeTruthy(); expect(current[0]?.discount_percentage).toBe(value);
  expect((screen.getByRole('button', { name: t('en', 'serviceSessions.samePercent') }) as HTMLButtonElement).disabled).toBe(true);
  expect(screen.getByText(t('en', 'serviceSessions.draftUnavailable'))).toBeTruthy();
});
it.each([String.fromCharCode(0x661, 0x660, 0x66b, 0x665), String.fromCharCode(0x6f1, 0x6f0, 0x66b, 0x6f5)])('normalizes localized percent %s for validation, bulk entry and summary', async (text) => {
  state.locale = 'ar'; render(<Harness prices={['7.125']} />); const percent = t('ar', 'serviceSessions.discountPercent');
  fireEvent.click(screen.getByRole('button', { name: percent })); change(percent, text);
  expect(screen.getByText('0.748')).toBeTruthy(); fireEvent.click(screen.getByRole('button', { name: t('ar', 'serviceSessions.samePercent') }));
  fireEvent.blur(screen.getByLabelText(percent)); await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
  expect(current[0]?.discount_percentage).toBe('10.5');
});
it('validates only the active mode after switching away from an invalid entry', async () => {
  state.locale = 'en'; const submit = vi.fn(); render(<Harness prices={['7.125']} onSubmit={submit} />);
  fireEvent.click(screen.getByRole('button', { name: t('en', 'serviceSessions.discountPercent') }));
  change(t('en', 'serviceSessions.discountPercent'), '100.01'); fireEvent.blur(screen.getByLabelText(t('en', 'serviceSessions.discountPercent')));
  await screen.findByRole('alert'); fireEvent.click(screen.getByRole('button', { name: t('en', 'serviceSessions.discountAmount') }));
  fireEvent.click(screen.getByRole('button', { name: 'Submit fixture' })); await waitFor(() => expect(submit).toHaveBeenCalledTimes(1));
  expect(current[0]?.discount_percentage).toBe('100.01');
});
it.each([['0.000', '0.000'], ['20.000', '20.000'], ['99999999999.999', '99999999999.999']])('shows exact draft net for price %s without list-price authority logic', (price, net) => {
  state.locale = 'en'; render(<Harness prices={[price]} />); expect(screen.getAllByText(net).length).toBeGreaterThan(1);
});
it('does not show a partial or wrapped total for invalid amount or sum overflow', async () => {
  state.locale = 'en'; render(<Harness prices={['99999999999.999', '0.001']} />);
  expect(screen.getByText(t('en', 'serviceSessions.draftUnavailable'))).toBeTruthy();
  const input = at(screen.getAllByLabelText(t('en', 'serviceSessions.discountAmount')), 1);
  fireEvent.change(input, { target: { value: '1.000' } }); fireEvent.blur(input); await screen.findByRole('alert');
  expect(current[1]?.discount_amount).toBe('1.000'); expect(screen.getByText(t('en', 'serviceSessions.draftUnavailable'))).toBeTruthy();
});
