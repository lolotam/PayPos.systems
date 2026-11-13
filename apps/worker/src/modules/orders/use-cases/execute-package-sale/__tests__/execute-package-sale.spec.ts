import { PackageRuleError } from '@pospay/domain';
import { expect, it } from 'vitest';
import { PackageSaleError, PackageSalePricingError } from '../../../domain/package-sale-errors.ts';
import { PackageSaleRetryError } from '../execute-package-sale.ts';
import {
  CLOCK_INSTANT,
  createHarness,
  RECORDED_AT,
  TWO_COMPONENT_TYPE,
} from './fixtures/execute-package-sale.ts';

it('runs the sale in the lock order the catalog and seller races depend on', async () => {
  const h = createHarness();
  await h.useCase.execute('company', 'request');
  // ترتيب الأقفال هو العقد نفسه: نوع ثم بائعة ثم قراءات، فالتسابق مع تعديل الكتالوج يتحدد منها.
  expect(h.calls).toEqual([
    'lockType',
    'lockSeller',
    'readPlace',
    'customerExists',
    'readSeller',
    'insert',
    'audit',
    'emit',
    'complete',
  ]);
  expect(h.completions).toEqual([
    { entitlementId: h.plans[0]?.entitlement.id ?? '', at: CLOCK_INSTANT },
  ]);
});

const namedRefusals = [
  {
    name: 'PackageSaleError',
    error: new PackageSaleError('PACKAGE_TYPE_NOT_FOUND'),
    code: 'PACKAGE_TYPE_NOT_FOUND',
    details: undefined,
  },
  {
    name: 'PackageSalePricingError',
    error: new PackageSalePricingError('PACKAGE_SALE_DISCOUNT_ABOVE_LIMIT', {
      limitBps: 1000,
      discountBps: 1600,
    }),
    code: 'PACKAGE_SALE_DISCOUNT_ABOVE_LIMIT',
    details: { limitBps: 1000, discountBps: 1600 },
  },
  {
    name: 'PackageRuleError',
    error: new PackageRuleError('INVALID_COMPONENTS'),
    code: 'INVALID_COMPONENTS',
    details: undefined,
  },
];

it.each(namedRefusals)(
  'marks a $name refusal failed with its code and details at the clock instant',
  async ({ error, code, details }) => {
    const h = createHarness({ scopeError: error });
    await h.useCase.execute('company', 'request');
    expect(h.failures).toEqual([{ code, details, at: CLOCK_INSTANT }]);
    expect(h.plans).toEqual([]);
  },
);

it('carries the named refusal into the retry error when the failure marking itself fails', async () => {
  const h = createHarness({
    scopeError: new PackageSaleError('PACKAGE_TYPE_NOT_FOUND'),
    failError: new Error('LOCK_TIMEOUT'),
  });
  await expect(h.useCase.execute('company', 'request')).rejects.toMatchObject({
    name: 'PackageSaleRetryError',
    failureCode: 'PACKAGE_TYPE_NOT_FOUND',
    failureDetails: undefined,
  });
});

const unknownFailures = [
  ['a plain error', new Error('connection reset')],
  ['a SQLSTATE-shaped error', Object.assign(new Error('deadlock detected'), { code: '40P01' })],
];

it.each(unknownFailures)('retries %s without failing the request', async (_name, error) => {
  const h = createHarness({ runError: error });
  const thrown = await h.useCase.execute('company', 'request').catch((reason: unknown) => reason);
  expect(thrown).toBeInstanceOf(PackageSaleRetryError);
  expect(thrown).toMatchObject({ failureCode: undefined });
  expect(h.failures).toEqual([]);
  expect(h.calls).toEqual([]);
});

it('refuses a discount above the limit frozen in the request', async () => {
  const h = createHarness({ request: { price_paid: '21.000', discount_limit_bps: 1000 } });
  await h.useCase.execute('company', 'request');
  expect(h.failures).toEqual([
    {
      code: 'PACKAGE_SALE_DISCOUNT_ABOVE_LIMIT',
      details: { limitBps: 1000, discountBps: 1600 },
      at: CLOCK_INSTANT,
    },
  ]);
});

it('closes the request with PACKAGE_SALE_FAILED when the sale branch is not active', async () => {
  const h = createHarness({ place: null });
  await h.useCase.execute('company', 'request');
  expect(h.failures).toEqual([
    { code: 'PACKAGE_SALE_FAILED', details: undefined, at: CLOCK_INSTANT },
  ]);
  expect(h.calls).toEqual(['lockType', 'lockSeller', 'readPlace']);
  expect(h.plans).toEqual([]);
});

it('writes nothing when the request is no longer pending', async () => {
  const h = createHarness({ skipWork: true });
  await expect(h.useCase.execute('company', 'request')).resolves.toBeUndefined();
  expect(h.calls).toEqual([]);
  expect(h.failures).toEqual([]);
});

it('gives the sale, its components and its sessions distinct identities', async () => {
  const h = createHarness({ type: TWO_COMPONENT_TYPE });
  await h.useCase.execute('company', 'request');
  const plan = h.plans[0];
  expect(plan).toBeDefined();
  const identities = [
    plan?.entitlement.id ?? '',
    ...(plan?.components.map((component) => component.id) ?? []),
    ...(plan?.components.flatMap((component) => component.slots.map((slot) => slot.id)) ?? []),
  ];
  expect(new Set(identities).size).toBe(identities.length);
  expect(identities).toHaveLength(1 + 2 + 12);
  expect(h.generated).toHaveLength(1 + 2 + 12);
  expect(plan?.components.map((component) => component.slots.map((slot) => slot.ordinal))).toEqual([
    [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
    [1, 2],
  ]);
});

it('dates the sale from the recorded request, not from the clock', async () => {
  const h = createHarness();
  await h.useCase.execute('company', 'request');
  const entitlement = h.plans[0]?.entitlement;
  expect(entitlement?.sold_at).toBe(RECORDED_AT);
  expect(entitlement?.sold_business_date).toBe('2026-11-05');
  expect(entitlement?.discount_bps).toBe(1000);
});

it('treats a missing sold_at as absent instead of an instant at the epoch', async () => {
  const h = createHarness({ request: { sold_at: null } });
  await h.useCase.execute('company', 'request');
  expect(h.plans[0]?.entitlement.sold_at).toBe(RECORDED_AT);
  expect(h.plans[0]?.entitlement.late).toBe(false);
});

it('keeps a back-dated sale on its own instant and marks it late', async () => {
  const h = createHarness({ request: { sold_at: '2026-10-01T00:00:00.000Z' } });
  await h.useCase.execute('company', 'request');
  expect(h.plans[0]?.entitlement.sold_at).toBe('2026-10-01T00:00:00.000Z');
  expect(h.plans[0]?.entitlement.sold_business_date).toBe('2026-10-01');
  expect(h.plans[0]?.entitlement.late).toBe(true);
});
