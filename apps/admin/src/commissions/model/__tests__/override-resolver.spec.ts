import { expect, it } from 'vitest';
import { t } from '@pospay/i18n';
import type { ResolverResult } from 'react-hook-form';
import type { OverrideDraft } from '../override-draft';
import { createOverrideResolver } from '../override-resolver';

const SERVICE = '01920000-0000-7000-8000-0000000000b3';

type OverrideResolverResult = ResolverResult<
  OverrideDraft,
  { service_id: string; rule: { kind: 'FOLLOW_PLAN' } | { kind: 'ZERO' } | { kind: 'PCT'; value: number } | { kind: 'FIXED'; value: string }; effective_from: string }
>;

function draft(overrides: Partial<OverrideDraft> = {}): OverrideDraft {
  return { kind: 'PCT', bps: '1500', amount: '', effectiveFrom: '2026-03-01', ...overrides };
}

function runResolver(serviceId: string, values: OverrideDraft): OverrideResolverResult {
  const resolver = createOverrideResolver(serviceId, 'en');
  return resolver(values, undefined, {
    fields: {},
    shouldUseNativeValidation: false,
  }) as OverrideResolverResult;
}

it('maps each field error to its catalog message', () => {
  const result = runResolver(SERVICE, draft({ bps: '10001' }));
  expect(result.errors).toEqual({
    bps: { type: 'validation', message: t('en', 'commissionOverrides.errorInvalidBps') },
  });
  const money = runResolver(SERVICE, draft({ kind: 'FIXED', amount: '-1.000' }));
  expect(money.errors).toEqual({
    amount: { type: 'validation', message: t('en', 'commissionOverrides.errorInvalidMoney') },
  });
  const date = runResolver(SERVICE, draft({ effectiveFrom: 'not-a-date' }));
  expect(date.errors).toEqual({
    effectiveFrom: { type: 'validation', message: t('en', 'commissionOverrides.errorInvalidDate') },
  });
});

it('an unmapped contract failure keeps the form invalid', () => {
  const result = runResolver('not-a-uuid', draft());
  expect(result.values).toEqual({});
  expect(result.errors).toEqual({
    kind: { type: 'validation', message: t('en', 'admin.unexpected') },
  });
});
