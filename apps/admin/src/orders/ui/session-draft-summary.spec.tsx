import { t } from '@pospay/i18n';
import { render, screen, within } from '@testing-library/react';
import { FormProvider, useForm } from 'react-hook-form';
import { expect, it, vi } from 'vitest';
import { createSessionDraft, type SessionDraftForm, type SessionDraftLine } from '../model/session-drafts';
import { SessionDraftSummary } from './session-draft-summary';

vi.mock('@/shared/locale/locale-context', () => ({ useLocale: () => 'en' }));

function paidLine(price = '10.000'): SessionDraftLine {
  return { ...createSessionDraft('paid'), service_id: 'service-paid', price };
}

function packageLine(price = ''): SessionDraftLine {
  return {
    ...createSessionDraft('package'),
    service_id: 'service-package',
    price,
    from_package: true,
    package_entitlement_id: 'entitlement-a',
  };
}

function Harness({ lines }: { lines: SessionDraftLine[] }) {
  const form = useForm<SessionDraftForm>({ defaultValues: { lines } });
  return <FormProvider {...form}><SessionDraftSummary /></FormProvider>;
}

function lineBlock(index: number) {
  const title = screen.getByText(t('en', 'serviceSessions.lineNumber').replace('{n}', String(index + 1)));
  const block = title.parentElement;
  if (!block) throw new Error('Missing summary line');
  return block;
}

it('totals only the paid line and shows a package line without a price error', () => {
  render(<Harness lines={[paidLine(), packageLine()]} />);

  const status = screen.getByRole('status');
  expect(status.textContent).toContain(t('en', 'serviceSessions.draftTotal'));
  expect(status.textContent).toContain('paid');
  expect(status.textContent).toContain('10.000');
  expect(screen.getByText(t('en', 'serviceSessions.fromPackage'))).toBeTruthy();
  expect(screen.queryByText(t('en', 'serviceSessions.invalidPrice'))).toBeNull();
});

it('shows a zero total for a package-only visit with an empty price', () => {
  render(<Harness lines={[packageLine()]} />);

  expect(screen.getByRole('status').textContent).toContain('0.000');
  expect(screen.queryByText(t('en', 'serviceSessions.invalidPrice'))).toBeNull();
  expect(screen.queryByText(t('en', 'serviceSessions.draftUnavailable'))).toBeNull();
});

it('ignores stale package prices while retaining paid-line price validation', () => {
  render(<Harness lines={[packageLine('invalid'), paidLine('invalid')]} />);

  expect(screen.getAllByText(t('en', 'serviceSessions.invalidPrice'))).toHaveLength(1);
  expect(screen.getByRole('status').textContent).toContain(t('en', 'serviceSessions.draftUnavailable'));
  expect(screen.getByRole('status').textContent).not.toContain('10.000');
});

it('hides price and discount details for a package line but shows them for a paid line', () => {
  render(<Harness lines={[packageLine(), paidLine()]} />);
  const packageRow = within(lineBlock(0));
  const paidRow = within(lineBlock(1));

  for (const key of ['price', 'discountAmount', 'draftNet'] as const) {
    expect(packageRow.queryByText(t('en', `serviceSessions.${key}`))).toBeNull();
    expect(paidRow.getByText(t('en', `serviceSessions.${key}`))).toBeTruthy();
  }
});
