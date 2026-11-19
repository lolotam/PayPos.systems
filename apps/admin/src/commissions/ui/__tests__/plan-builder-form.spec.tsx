import type { CommissionValidationError } from '@pospay/commissions-engine/validation';
import type { CreateCommissionPlanVersionInput } from '@pospay/contracts';
import { t } from '@pospay/i18n';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import type { PlanDraft, TiersDraft } from '../../model/plan-draft';
import { emptyPlanDraft } from '../../model/plan-draft';
import { PlanBuilderForm } from '../plan-builder-form';

const state = vi.hoisted(() => ({ locale: 'en' as 'ar' | 'en' }));
vi.mock('@/shared/locale/locale-context', () => ({ useLocale: () => state.locale }));

const NOW = new Date('2026-11-20T10:00:00Z');
const ZONE = 'Asia/Kuwait';
const B = {
  base: t('en', 'commissionPlanBuilder.blockBase'),
  tiers: t('en', 'commissionPlanBuilder.blockTiers'),
  packageSale: t('en', 'commissionPlanBuilder.blockPackageSale'),
  on: t('en', 'commissionPlanBuilder.blockOn'),
  off: t('en', 'commissionPlanBuilder.blockOff'),
  effectiveFrom: t('en', 'commissionPlanBuilder.effectiveFrom'),
  bpsLabel: t('en', 'commissionPlanBuilder.bpsLabel'),
  amountLabel: t('en', 'commissionPlanBuilder.amountLabel'),
  thresholdValue: t('en', 'commissionPlanBuilder.thresholdValue'),
  addStep: t('en', 'commissionPlanBuilder.addStep'),
  save: t('en', 'commissionPlanBuilder.save'),
  saving: t('en', 'commissionPlanBuilder.saving'),
};

function block(name: string): HTMLElement {
  return screen.getByRole('group', { name });
}

function part<T>(items: readonly T[], at: number): T {
  const item = items[at];
  if (item === undefined) throw new Error(`missing item at index ${at}`);
  return item;
}

function saveButton(): HTMLButtonElement {
  return screen.getByRole('button', { name: B.save }) as HTMLButtonElement;
}

function pctCalc(bps: string) {
  return { kind: 'PCT' as const, bps, amount: '' };
}

function fixedCalc(amount: string) {
  return { kind: 'FIXED' as const, bps: '', amount: amount };
}

function tiersWith(steps: PlanDraft['tiers']['steps']): TiersDraft {
  return { enabled: true, touched: true, mode: 'MARGINAL', accumulator: 'AMOUNT', steps };
}

function planInvalid(code: CommissionValidationError): unknown {
  return {
    code: 'COMMISSION_PLAN_INVALID',
    message_ar: 'عربي',
    message_en: 'english',
    details: { code },
  };
}

function renderForm(initial: PlanDraft, serverError: unknown = null, onSave = vi.fn()) {
  return render(
    <PlanBuilderForm initial={initial} pending={false} serverError={serverError} onSubmit={onSave} />,
  );
}

function rerenderWith(view: ReturnType<typeof renderForm>, initial: PlanDraft, serverError: unknown, onSave = vi.fn()) {
  view.rerender(
    <PlanBuilderForm initial={initial} pending={false} serverError={serverError} onSubmit={onSave} />,
  );
}

it('renders the three blocks with switches and shows no formula text', () => {
  renderForm(emptyPlanDraft(ZONE, NOW));
  for (const [name, label] of [
    [B.base, B.off],
    [B.tiers, B.off],
    [B.packageSale, B.off],
  ] as const) {
    const area = block(name);
    expect(within(area).getByRole('switch')).toBeTruthy();
    expect(within(area).getByRole('switch', { name: label })).toBeTruthy();
  }
  expect(document.body.textContent).not.toContain('of every sale');
  expect(document.body.textContent).not.toContain('% of');
});

it('shows NO_STEPS inside the tiers block and disables save when tiers turn on empty', async () => {
  renderForm(emptyPlanDraft(ZONE, NOW));
  const tiers = block(B.tiers);
  fireEvent.click(within(tiers).getByRole('switch'));
  const alert = await within(tiers).findByRole('alert');
  expect(alert.textContent).toBe(t('en', 'commissionPlanBuilder.errorNoSteps'));
  expect(saveButton().disabled).toBe(true);
});

it('enables save after adding a valid step to the tiers block', async () => {
  renderForm(emptyPlanDraft(ZONE, NOW));
  const tiers = block(B.tiers);
  fireEvent.click(within(tiers).getByRole('switch'));
  await within(tiers).findByRole('alert');
  fireEvent.click(within(tiers).getByRole('button', { name: B.addStep }));
  const valueInput = await within(tiers).findByLabelText(B.thresholdValue);
  fireEvent.change(valueInput, { target: { value: '1000' } });
  const bpsInput = await within(tiers).findByLabelText(B.bpsLabel);
  fireEvent.change(bpsInput, { target: { value: '100' } });
  await waitFor(() => expect(saveButton().disabled).toBe(false));
});

it('shows STEPS_NOT_ASCENDING inside tiers while the base block stays clean', async () => {
  const initial = {
    ...emptyPlanDraft(ZONE, NOW),
    base: { enabled: true, calc: pctCalc('500') },
    tiers: tiersWith([
      { fromKind: 'AMOUNT' as const, fromValue: '10.000', calc: pctCalc('100') },
    ]),
  };
  renderForm(initial);
  const tiers = block(B.tiers);
  fireEvent.click(within(tiers).getByRole('button', { name: B.addStep }));
  const values = within(tiers).getAllByLabelText(B.thresholdValue);
  fireEvent.change(part(values, 1), { target: { value: '5.000' } });
  const bpsInputs = within(tiers).getAllByLabelText(B.bpsLabel);
  fireEvent.change(part(bpsInputs, 1), { target: { value: '100' } });
  const alert = await within(tiers).findByRole('alert');
  expect(alert.textContent).toBe(t('en', 'commissionPlanBuilder.errorStepsNotAscending'));
  expect(within(block(B.base)).queryByRole('alert')).toBeNull();
  expect(saveButton().disabled).toBe(true);
});

it('refuses the year 0000 with a visible message and a disabled save', async () => {
  renderForm({ ...emptyPlanDraft(ZONE, NOW), base: { enabled: true, calc: pctCalc('500') } });
  fireEvent.change(screen.getByLabelText(B.effectiveFrom), { target: { value: '0000-01-01' } });
  const alert = await screen.findByRole('alert');
  expect(alert.textContent).toBe(t('en', 'commissionPlanBuilder.errorInvalidDate'));
  expect(saveButton().disabled).toBe(true);
});

it('refuses an over-long amount with a visible message and a disabled save', async () => {
  renderForm({ ...emptyPlanDraft(ZONE, NOW), base: { enabled: true, calc: fixedCalc('12345678901234.000') } });
  const alert = await within(block(B.base)).findByRole('alert');
  expect(alert.textContent).toBe(t('en', 'commissionPlanBuilder.errorInvalidMoney'));
  expect(saveButton().disabled).toBe(true);
});

it('refuses a salary multiple of 10000.00 with a visible message and a disabled save', async () => {
  renderForm({
    ...emptyPlanDraft(ZONE, NOW),
    tiers: tiersWith([{ fromKind: 'SALARY_MULTIPLE' as const, fromValue: '10000.00', calc: pctCalc('100') }]),
  });
  const alert = await within(block(B.tiers)).findByRole('alert');
  expect(alert.textContent).toBe(t('en', 'commissionPlanBuilder.errorInvalidMultiple'));
  expect(saveButton().disabled).toBe(true);
});

it('submits a valid body whose KWD money stays text', async () => {
  const onSave = vi.fn();
  renderForm(
    { ...emptyPlanDraft(ZONE, NOW), base: { enabled: true, calc: fixedCalc('1.25') } },
    null,
    onSave,
  );
  await waitFor(() => expect(saveButton().disabled).toBe(false));
  fireEvent.click(saveButton());
  await waitFor(() => expect(onSave).toHaveBeenCalled());
  const body = onSave.mock.calls[0]?.[0] as CreateCommissionPlanVersionInput;
  expect(body.base).toEqual({ enabled: true, calc: { kind: 'FIXED', amount: '1.250' } });
  if (!body.base.enabled || body.base.calc.kind !== 'FIXED') {
    throw new Error('the submitted base calc is not a fixed amount');
  }
  expect(typeof body.base.calc.amount).toBe('string');
  expect(body.base.calc.amount).toBe('1.250');
  expect(body.effective_from).toBe('2026-11-20');
  expect(body.whole_period).toBe(false);
  expect(body.tiers).toEqual({ enabled: false });
  expect(body.package_sale).toEqual({ enabled: false });
});

it('shows a server INVALID_CALC inside the base block when base alone reproduces the code', async () => {
  const initial = { ...emptyPlanDraft(ZONE, NOW), base: { enabled: true, calc: pctCalc('10001') } };
  const view = renderForm(initial);
  rerenderWith(view, initial, planInvalid('INVALID_CALC'));
  const alert = await within(block(B.base)).findByRole('alert');
  expect(alert.textContent).toBe(t('en', 'commissionPlanBuilder.errorInvalidCalc'));
  expect(screen.getAllByRole('alert').length).toBe(1);
});

it('shows a server INVALID_CALC inside the package-sale block when it alone reproduces the code', async () => {
  const initial = {
    ...emptyPlanDraft(ZONE, NOW),
    packageSale: { enabled: true, calc: pctCalc('10001') },
  };
  const view = renderForm(initial);
  rerenderWith(view, initial, planInvalid('INVALID_CALC'));
  const alert = await within(block(B.packageSale)).findByRole('alert');
  expect(alert.textContent).toBe(t('en', 'commissionPlanBuilder.errorInvalidCalc'));
  expect(screen.getAllByRole('alert').length).toBe(1);
});

it('shows an ambiguous INVALID_CALC at form level when two blocks reproduce the code', async () => {
  const initial = {
    ...emptyPlanDraft(ZONE, NOW),
    base: { enabled: true, calc: pctCalc('10001') },
    packageSale: { enabled: true, calc: pctCalc('10001') },
  };
  renderForm(initial, planInvalid('INVALID_CALC'));
  expect(await screen.findByRole('alert')).toBeTruthy();
  expect(screen.getAllByRole('alert').length).toBe(3);
  expect(within(block(B.base)).getByRole('alert')).toBeTruthy();
  expect(within(block(B.packageSale)).getByRole('alert')).toBeTruthy();
});

it('shows a server code at form level when the sent body passes the local check', async () => {
  const onSave = vi.fn();
  const initial = { ...emptyPlanDraft(ZONE, NOW), base: { enabled: true, calc: pctCalc('500') } };
  const view = renderForm(initial, null, onSave);
  await waitFor(() => expect(saveButton().disabled).toBe(false));
  fireEvent.click(saveButton());
  await waitFor(() => expect(onSave).toHaveBeenCalled());
  rerenderWith(view, initial, planInvalid('STEPS_NOT_ASCENDING'), onSave);
  const alert = await screen.findByRole('alert');
  expect(alert.textContent).toBe(t('en', 'commissionPlanBuilder.errorStepsNotAscending'));
  expect(within(block(B.base)).queryByRole('alert')).toBeNull();
});

it('clears the server message as soon as any field changes', async () => {
  const onSave = vi.fn();
  const initial = { ...emptyPlanDraft(ZONE, NOW), base: { enabled: true, calc: pctCalc('500') } };
  const view = renderForm(initial, null, onSave);
  await waitFor(() => expect(saveButton().disabled).toBe(false));
  fireEvent.click(saveButton());
  await waitFor(() => expect(onSave).toHaveBeenCalled());
  rerenderWith(view, initial, planInvalid('STEPS_NOT_ASCENDING'), onSave);
  expect((await screen.findByRole('alert')).textContent).toBe(
    t('en', 'commissionPlanBuilder.errorStepsNotAscending'),
  );
  fireEvent.change(within(block(B.base)).getByLabelText(B.bpsLabel), {
    target: { value: '600' },
  });
  await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
});

it('disables save and shows the saving label while pending', () => {
  const initial = { ...emptyPlanDraft(ZONE, NOW), base: { enabled: true, calc: pctCalc('500') } };
  const view = render(
    <PlanBuilderForm initial={initial} pending={false} serverError={null} onSubmit={vi.fn()} />,
  );
  view.rerender(
    <PlanBuilderForm initial={initial} pending={true} serverError={null} onSubmit={vi.fn()} />,
  );
  const saving = screen.getByRole('button', { name: B.saving }) as HTMLButtonElement;
  expect(saving.disabled).toBe(true);
});
