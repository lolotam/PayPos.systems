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
  removeStep: t('en', 'commissionPlanBuilder.removeStep'),
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

it('renders the three blocks with switches named by their block titles and shows the state text', () => {
  renderForm(emptyPlanDraft(ZONE, NOW));
  for (const name of [B.base, B.tiers, B.packageSale]) {
    const area = block(name);
    const toggle = within(area).getByRole('switch', { name });
    expect(within(area).getByText(B.off)).toBeTruthy();
    fireEvent.click(toggle);
    expect(within(area).getByRole('switch', { name })).toBeTruthy();
    expect(within(area).getByText(B.on)).toBeTruthy();
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

it('shows the no-steps alert inside tiers and disables save after the last step is removed', async () => {
  const initial = {
    ...emptyPlanDraft(ZONE, NOW),
    base: { enabled: true, calc: pctCalc('500') },
    tiers: tiersWith([{ fromKind: 'AMOUNT' as const, fromValue: '10.000', calc: pctCalc('100') }]),
  };
  renderForm(initial);
  await waitFor(() => expect(saveButton().disabled).toBe(false));
  const tiers = block(B.tiers);
  fireEvent.click(within(tiers).getByRole('button', { name: B.removeStep }));
  const alert = await within(tiers).findByRole('alert');
  expect(alert.textContent).toBe(t('en', 'commissionPlanBuilder.errorNoSteps'));
  expect(saveButton().disabled).toBe(true);
});

it('replaces the no-steps alert with the real step error after adding a step to empty tiers', async () => {
  renderForm(emptyPlanDraft(ZONE, NOW));
  const tiers = block(B.tiers);
  fireEvent.click(within(tiers).getByRole('switch'));
  expect((await within(tiers).findByRole('alert')).textContent).toBe(
    t('en', 'commissionPlanBuilder.errorNoSteps'),
  );
  fireEvent.click(within(tiers).getByRole('button', { name: B.addStep }));
  const alert = await within(tiers).findByRole('alert');
  expect(alert.textContent).toBe(t('en', 'commissionPlanBuilder.errorInvalidBps'));
  expect(saveButton().disabled).toBe(true);
});

it('drops a blank retained step when tiers switch off and keeps save enabled', async () => {
  const initial = { ...emptyPlanDraft(ZONE, NOW), base: { enabled: true, calc: pctCalc('500') } };
  renderForm(initial);
  const tiers = block(B.tiers);
  fireEvent.click(within(tiers).getByRole('switch'));
  await within(tiers).findByRole('alert');
  fireEvent.click(within(tiers).getByRole('button', { name: B.addStep }));
  await within(tiers).findByRole('alert');
  fireEvent.click(within(tiers).getByRole('switch'));
  await waitFor(() => expect(saveButton().disabled).toBe(false));
  expect(within(tiers).queryByRole('alert')).toBeNull();
});

it('drops a malformed retained bps when the base block is off and keeps save enabled', async () => {
  renderForm({ ...emptyPlanDraft(ZONE, NOW), base: { enabled: false, calc: pctCalc('abc') } });
  expect(within(block(B.base)).queryByRole('alert')).toBeNull();
  await waitFor(() => expect(saveButton().disabled).toBe(false));
});

it('refuses an unparseable whole-period flag with a visible plan message and never saves', async () => {
  const onSave = vi.fn();
  const initial = {
    ...emptyPlanDraft(ZONE, NOW),
    base: { enabled: true, calc: pctCalc('500') },
    wholePeriod: 'yes' as unknown as boolean,
  };
  renderForm(initial, null, onSave);
  const alert = await within(block(B.base)).findByRole('alert');
  expect(alert.textContent).toBe(t('en', 'commissionPlanBuilder.errorInvalidPlan'));
  expect(saveButton().disabled).toBe(true);
  fireEvent.click(saveButton());
  expect(onSave).not.toHaveBeenCalled();
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

it('shows a server code at form level when the form has not submitted a body', async () => {
  const initial = { ...emptyPlanDraft(ZONE, NOW), base: { enabled: true, calc: pctCalc('500') } };
  const view = renderForm(initial);
  rerenderWith(view, initial, planInvalid('INVALID_CALC'));
  const alert = await screen.findByRole('alert');
  expect(alert.textContent).toBe(t('en', 'commissionPlanBuilder.errorInvalidCalc'));
  expect(screen.getAllByRole('alert').length).toBe(1);
  expect(within(block(B.base)).queryByRole('alert')).toBeNull();
  expect(within(block(B.packageSale)).queryByRole('alert')).toBeNull();
});

it('shows a late server error at form level, not on the body the admin has since changed', async () => {
  const onSave = vi.fn();
  const initial = { ...emptyPlanDraft(ZONE, NOW), base: { enabled: true, calc: pctCalc('500') } };
  const view = renderForm(initial, null, onSave);
  await waitFor(() => expect(saveButton().disabled).toBe(false));
  fireEvent.click(saveButton());
  await waitFor(() => expect(onSave).toHaveBeenCalled());
  fireEvent.change(within(block(B.base)).getByLabelText(B.bpsLabel), {
    target: { value: '10001' },
  });
  rerenderWith(view, initial, planInvalid('INVALID_CALC'), onSave);
  await waitFor(() => expect(screen.getAllByRole('alert').length).toBe(2));
  expect(within(block(B.base)).getByRole('alert').textContent).toBe(
    t('en', 'commissionPlanBuilder.errorInvalidCalc'),
  );
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
