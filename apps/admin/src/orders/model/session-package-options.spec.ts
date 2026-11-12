import type { CustomerPackageListItem } from '@pospay/contracts';
import { expect, it } from 'vitest';
import { createSessionDraft } from './session-drafts';
import {
  clearPackagePicks,
  packageOptionsForService,
  suggestPackage,
  type PackageOption,
} from './session-package-options';

const serviceId = 'service-a';

type ItemPatch = Partial<Pick<CustomerPackageListItem,
  'name_en' | 'expires_on' | 'expired' | 'used_up'
>>;

function packageItem(
  id: string,
  componentServiceId: string,
  remaining: number,
  patch: ItemPatch = {},
): CustomerPackageListItem {
  return {
    id,
    provenance: 'SOLD',
    name_en: `Package ${id}`,
    name_ar: null,
    expires_on: '2026-12-31',
    expired: false,
    used_up: false,
    price_paid: '20.000',
    refunded_amount: '0.000',
    components: [{
      id: `component-${id}`,
      service_id: componentServiceId,
      position: 1,
      name_en: 'Synthetic service',
      name_ar: null,
      sessions_total: Math.max(1, remaining),
      remaining,
      used: 0,
      refunded: 0,
      next_unit_value: '10.000',
      slot_values: [{ unit_value: '10.000', free: remaining, used: 0, refunded: 0 }],
    }],
    ...patch,
  };
}

function option(id: string, patch: Partial<PackageOption> = {}): PackageOption {
  return {
    id,
    name_en: `Package ${id}`,
    name_ar: null,
    expires_on: '2026-12-31',
    expired: false,
    remaining: 1,
    ...patch,
  };
}

it('keeps service matches in list order and reduces only by other picks of the same entitlement and service', () => {
  const first = packageItem('a', serviceId, 2);
  const expired = packageItem('d', serviceId, 3, { expired: true, expires_on: '2026-10-01' });
  const items = [
    first,
    packageItem('b', 'another-service', 4),
    packageItem('c', serviceId, 3, { used_up: true }),
    expired,
    packageItem('e', serviceId, 0),
    packageItem('f', serviceId, 4),
  ];
  const otherPicks = [
    { entitlement_id: 'a', service_id: serviceId },
    { entitlement_id: 'a', service_id: serviceId },
    { entitlement_id: 'a', service_id: 'another-service' },
    { entitlement_id: 'f', service_id: 'another-service' },
    { entitlement_id: 'another-package', service_id: serviceId },
  ];

  expect(packageOptionsForService(items, serviceId, otherPicks, '2026-10-02').map((row) =>
    [row.id, row.remaining],
  )).toEqual([['a', 0], ['f', 4]]);
  expect(packageOptionsForService(items, serviceId, otherPicks, '2026-09-30').map((row) => row.id))
    .toEqual(['a', 'd', 'f']);
});

it('keeps an option listed at zero when other picks exceed its remaining sessions', () => {
  const item = packageItem('a', serviceId, 1);
  const otherPicks = [
    { entitlement_id: 'a', service_id: serviceId },
    { entitlement_id: 'a', service_id: serviceId },
  ];

  expect(packageOptionsForService([item], serviceId, otherPicks, '2026-06-15')).toEqual([
    expect.objectContaining({ id: 'a', remaining: 0 }),
  ]);
});

it.each([
  ['before', '2026-06-15', true],
  ['after', '2026-07-01', false],
  ['on', '2026-06-30', true],
] as const)('lists a package expired today for a visit %s its expiry', (_position, visitDate, listed) => {
  const item = packageItem('a', serviceId, 1, { expires_on: '2026-06-30', expired: true });
  const options = packageOptionsForService([item], serviceId, [], visitDate);

  expect(options.map((row) => row.id)).toEqual(listed ? ['a'] : []);
});

it('excludes a package whose expiry precedes the visit even when it is not expired today', () => {
  const item = packageItem('a', serviceId, 1, { expires_on: '2026-06-30', expired: false });

  expect(packageOptionsForService([item], serviceId, [], '2026-07-01')).toEqual([]);
});

it('suggests the smallest usable expiry and breaks an expiry tie by id', () => {
  const options = [
    option('b', { expires_on: '2027-01-01' }),
    option('a', { expires_on: '2027-01-01' }),
    option('c', { expires_on: '2026-11-30' }),
    option('d', { expires_on: '2026-10-01', expired: true }),
    option('e', { expires_on: '2026-10-02', remaining: 0 }),
  ];
  expect(suggestPackage(options, '2026-11-01')).toBe('c');
  expect(suggestPackage(options.filter((row) => row.id !== 'c'), '2026-11-01')).toBe('a');
});

it('suggests a package valid on a back-dated visit even when it is expired today', () => {
  const options = [
    option('later', { expires_on: '2026-12-31' }),
    option('backdated', { expires_on: '2026-10-01', expired: true }),
  ];

  expect(suggestPackage(options, '2026-09-30')).toBe('backdated');
});

it('never suggests visit-expired or exhausted options and returns null when none are usable', () => {
  expect(suggestPackage([
    option('a', { expired: true }),
    option('b', { remaining: 0 }),
  ], '2027-01-01')).toBeNull();
});

it('clears package mode and entitlement picks on every line without changing paid values', () => {
  const packageLine = {
    ...createSessionDraft('package'),
    service_id: serviceId,
    price: 'stale-price',
    from_package: true,
    package_entitlement_id: 'entitlement-a',
  };
  const paidLine = { ...createSessionDraft('paid'), price: '7.125' };
  const cleared = clearPackagePicks([packageLine, paidLine]);

  expect(cleared.map((line) => [line.from_package, line.package_entitlement_id])).toEqual([
    [false, null],
    [false, null],
  ]);
  expect(cleared[0]?.price).toBe('stale-price');
  expect(cleared[1]?.price).toBe('7.125');
  expect(packageLine.from_package).toBe(true);
  expect(packageLine.package_entitlement_id).toBe('entitlement-a');
});
