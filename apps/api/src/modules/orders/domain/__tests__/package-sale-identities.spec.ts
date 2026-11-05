import { expect, it } from 'vitest';
import { PackageSaleIdentityInvariantError } from '../errors.ts';
import { planPackageSale } from '../package-sale-plan.ts';
import { componentIdentity, identities, input } from './fixtures/package-sale.ts';

it('retains each supplied slot ID by service and ordinal, independent of identity order', () => {
  const supplied = structuredClone(identities);
  supplied.components[0]?.slots.reverse();
  const before = structuredClone(supplied);
  const plan = planPackageSale(input, supplied);
  expect(
    plan.components[0]?.slots.map(({ ordinal, id, unitValue }) => ({ ordinal, id, unitValue })),
  ).toEqual(
    Array.from({ length: 10 }, (_, index) => ({
      ordinal: index + 1,
      id: `slot-${index + 1}`,
      unitValue: 2250n,
    })),
  );
  expect(supplied).toEqual(before);
  expect(planPackageSale(input, supplied)).toEqual(plan);
  const slot = supplied.components[0]?.slots[0];
  if (!slot) throw new Error('fixture needs a slot');
  slot.id = 'changed-after-planning';
  expect(
    plan.components.flatMap((component) => component.slots).some(({ id }) => id === slot.id),
  ).toBe(false);
});

const validSlots = identities.components[0]?.slots ?? [];
it.each([
  { name: 'missing all', slots: [] },
  { name: 'missing one', slots: validSlots.slice(1) },
  { name: 'extra', slots: [...validSlots, { ordinal: 11, id: 'extra' }] },
  { name: 'duplicate ordinal', slots: validSlots.map((slot) => ({ ...slot, ordinal: 1 })) },
  { name: 'duplicate ID', slots: validSlots.map((slot) => ({ ...slot, id: 'duplicate' })) },
  { name: 'empty ID', slots: validSlots.map((slot) => ({ ...slot, id: '' })) },
  {
    name: 'ordinal zero',
    slots: validSlots.map((slot) => ({ ...slot, ordinal: slot.ordinal - 1 })),
  },
  {
    name: 'ordinal beyond count',
    slots: validSlots.map((slot) => ({ ...slot, ordinal: slot.ordinal + 1 })),
  },
  {
    name: 'fractional ordinal',
    slots: validSlots.map((slot) => ({ ...slot, ordinal: slot.ordinal + 0.5 })),
  },
  { name: 'nonfinite ordinal', slots: validSlots.map((slot) => ({ ...slot, ordinal: NaN })) },
])('rejects $name slot identities as an internal typed invariant', ({ slots }) => {
  const bad = { ...identities, components: [{ serviceId: 'service', id: 'component', slots }] };
  const before = structuredClone(bad);
  expect(() => planPackageSale(input, bad)).toThrow(PackageSaleIdentityInvariantError);
  expect(bad).toEqual(before);
});

it('refuses slot IDs repeated across different components, and keeps each service mapping exact', () => {
  const source = input.type.components[0];
  if (!source) throw new Error('fixture needs component');
  const components = ['a', 'b'].map((service_id, index) => ({
    ...source,
    service_id,
    sessions: 1,
    position: index + 1,
    service: { ...source.service, id: service_id },
  }));
  const supplied = {
    saleId: 'sale',
    components: [componentIdentity('b', 1), componentIdentity('a', 1)],
  };
  const plan = planPackageSale({ ...input, type: { ...input.type, components } }, supplied);
  expect(plan.components.map(({ service_id, slots }) => [service_id, slots[0]?.id])).toEqual([
    ['a', 'a-slot-1'],
    ['b', 'b-slot-1'],
  ]);
  const duplicate = supplied.components.map((identity) => ({
    ...identity,
    slots: [{ ordinal: 1, id: 'same' }],
  }));
  expect(() =>
    planPackageSale(
      { ...input, type: { ...input.type, components } },
      { ...supplied, components: duplicate },
    ),
  ).toThrow(PackageSaleIdentityInvariantError);
});

it.each([
  { ...identities, saleId: '' },
  {
    ...identities,
    components: identities.components.map((component) => ({ ...component, id: '' })),
  },
])('keeps malformed generated sale/component IDs internal, without a public error code', (bad) => {
  expect(() => planPackageSale(input, bad)).toThrow(PackageSaleIdentityInvariantError);
  try {
    planPackageSale(input, bad);
  } catch (error) {
    expect(error).not.toHaveProperty('code');
  }
});
