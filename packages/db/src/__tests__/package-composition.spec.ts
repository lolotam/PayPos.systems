import { sql } from 'drizzle-orm';
import { expect, it } from 'vitest';
import {
  A,
  B,
  SECOND_SERVICE,
  SALE,
  SALE_COMPONENT,
  owner,
  db,
  nextId,
  rejected,
  entitlementInsert,
  componentInsert,
  slotInsert,
  attempt,
  compose,
} from './package-composition.fixture.ts';

it('a sale with one session fewer than the component promises is refused', async () => {
  await rejected(
    compose(nextId(), [{ id: nextId(), slots: [1, 2] }]),
    '23514',
    'package_entitlement_value_conservation',
  );
});

it('a sale with one session more than the component promises is refused', async () => {
  await rejected(
    compose(nextId(), [{ id: nextId(), slots: [1, 2, 3, 4] }]),
    '23514',
    'package_session_slots_ordinal_range',
  );
});

it('a sale whose sessions do not sum to the component value is refused', async () => {
  await rejected(
    compose(
      nextId(),
      [{ id: nextId(), options: { value: '25.000', sessions: 2 }, slots: [1, 2] }],
      { pricePaid: '25.000' },
    ),
    '23514',
    'package_entitlement_value_conservation',
  );
});

it('a sale whose components do not sum to the price paid is refused', async () => {
  await rejected(
    compose(
      nextId(),
      [
        { id: nextId(), options: { value: '10.000', sessions: 1 }, slots: [1] },
        {
          id: nextId(),
          options: { value: '10.000', sessions: 1, serviceId: SECOND_SERVICE, position: 2 },
          slots: [1],
        },
      ],
      { pricePaid: '25.000' },
    ),
    '23514',
    'package_entitlement_value_conservation',
  );
});

it('an entitlement with no component at all is refused', async () => {
  await rejected(compose(nextId(), []), '23514', 'package_entitlement_value_conservation');
});

it('sessions that skip a number are refused', async () => {
  await rejected(
    compose(
      nextId(),
      [
        {
          id: nextId(),
          options: { value: '100.000', sessions: 11 },
          slots: [1, 2, 3, 4, 5, 6, 7, 8, 9, 11],
        },
      ],
      { pricePaid: '100.000' },
    ),
    '23514',
    'package_entitlement_value_conservation',
  );
  await rejected(
    compose(
      nextId(),
      [
        {
          id: nextId(),
          options: { value: '100.000', sessions: 11 },
          slots: [2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
        },
      ],
      { pricePaid: '100.000' },
    ),
    '23514',
    'package_entitlement_value_conservation',
  );
});

it('imported used sessions that are not the first k ordinals are refused', async () => {
  await rejected(
    compose(
      nextId(),
      [{ id: nextId(), slots: [1, 2, 3], states: ['IMPORTED_USED', 'FREE', 'IMPORTED_USED'] }],
      { provenance: 'IMPORTED', externalRef: 'EXT-1', importRow: 1 },
    ),
    '23514',
    'package_entitlement_value_conservation',
  );
  await rejected(
    compose(
      nextId(),
      [{ id: nextId(), slots: [1, 2, 3], states: ['FREE', 'IMPORTED_USED', 'IMPORTED_USED'] }],
      { provenance: 'IMPORTED', externalRef: 'EXT-2', importRow: 2 },
    ),
    '23514',
    'package_entitlement_value_conservation',
  );
});

it('a component of another transaction never joins an entitlement', async () => {
  await db.withTenant(A.company, async (tx) => {
    await tx.execute(entitlementInsert(SALE));
    await tx.execute(componentInsert(SALE_COMPONENT, SALE));
    for (let ordinal = 1; ordinal <= 3; ordinal += 1) {
      await tx.execute(slotInsert(nextId(), SALE, SALE_COMPONENT, ordinal));
    }
  });
  await rejected(
    attempt(
      componentInsert(nextId(), SALE, {
        value: '0.000',
        sessions: 1,
        serviceId: SECOND_SERVICE,
        position: 2,
      }),
    ),
    '23514',
    'package_components_creation_seal',
  );
  await rejected(
    attempt(slotInsert(nextId(), SALE, SALE_COMPONENT, 4)),
    '23514',
    'package_session_slots_creation_seal',
  );
});

it('the composition closes once the deferred check has run', async () => {
  const entitlementId = nextId();
  const componentId = nextId();
  await rejected(
    db.withTenant(A.company, async (tx) => {
      await tx.execute(entitlementInsert(entitlementId));
      await tx.execute(componentInsert(componentId, entitlementId));
      for (let ordinal = 1; ordinal <= 3; ordinal += 1) {
        await tx.execute(slotInsert(nextId(), entitlementId, componentId, ordinal));
      }
      await tx.execute(sql`SET CONSTRAINTS ALL IMMEDIATE`);
      await tx.execute(slotInsert(nextId(), entitlementId, componentId, 4));
    }),
    '23514',
    'package_session_slots_ordinal_range',
  );
  await rejected(
    db.withTenant(A.company, async (tx) => {
      await tx.execute(entitlementInsert(entitlementId));
      await tx.execute(componentInsert(componentId, entitlementId));
      for (let ordinal = 1; ordinal <= 3; ordinal += 1) {
        await tx.execute(slotInsert(nextId(), entitlementId, componentId, ordinal));
      }
      await tx.execute(sql`SET CONSTRAINTS ALL IMMEDIATE`);
      await tx.execute(sql`SET CONSTRAINTS ALL DEFERRED`);
      await tx.execute(slotInsert(nextId(), entitlementId, componentId, 4));
    }),
    '23514',
    'package_session_slots_ordinal_range',
  );
  await rejected(
    db.withTenant(A.company, async (tx) => {
      await tx.execute(entitlementInsert(entitlementId));
      await tx.execute(componentInsert(componentId, entitlementId));
      for (let ordinal = 1; ordinal <= 3; ordinal += 1) {
        await tx.execute(slotInsert(nextId(), entitlementId, componentId, ordinal));
      }
      await tx.execute(sql`SET CONSTRAINTS ALL IMMEDIATE`);
      await tx.execute(
        componentInsert(nextId(), entitlementId, {
          value: '0.000',
          sessions: 1,
          serviceId: SECOND_SERVICE,
          position: 2,
        }),
      );
    }),
    '23514',
    'package_components_closed_composition',
  );
});

it('a session of one entitlement never names a component of another', async () => {
  const first = nextId();
  const second = nextId();
  const firstComponent = nextId();
  const secondComponent = nextId();
  await rejected(
    db.withTenant(A.company, async (tx) => {
      await tx.execute(entitlementInsert(first));
      await tx.execute(entitlementInsert(second));
      await tx.execute(componentInsert(firstComponent, first));
      await tx.execute(componentInsert(secondComponent, second));
      await tx.execute(slotInsert(nextId(), first, secondComponent, 1));
    }),
    '23503',
    'package_session_slots_component_fk',
  );
});

it('a session of another business never joins an entitlement', async () => {
  const entitlementId = nextId();
  const componentId = nextId();
  await rejected(
    db.withTenant(A.company, async (tx) => {
      await tx.execute(entitlementInsert(entitlementId));
      await tx.execute(componentInsert(componentId, entitlementId));
      await tx.execute(sql`
        INSERT INTO package_session_slots
          (company_id,id,business_id,entitlement_id,component_id,ordinal,unit_value,state)
        VALUES (${A.company},${nextId()},${B.business},${entitlementId},${componentId},1,10.000,'FREE')`);
    }),
    '23503',
    'package_session_slots_component_fk',
  );
});

it('a valid sale and a valid import both commit', async () => {
  const saleId = nextId();
  await compose(saleId, [{ id: nextId(), slots: [1, 2, 3] }]);
  const importId = nextId();
  await compose(
    importId,
    [{ id: nextId(), slots: [1, 2, 3], states: ['IMPORTED_USED', 'FREE', 'FREE'] }],
    { provenance: 'IMPORTED', externalRef: 'EXT-VALID', importRow: 9 },
  );
  const rows = await owner`SELECT id, provenance, price_paid FROM package_entitlements
    WHERE id IN (${saleId}, ${importId}) ORDER BY provenance`;
  expect(rows).toEqual([
    { id: importId, provenance: 'IMPORTED', price_paid: '30.000' },
    { id: saleId, provenance: 'SOLD', price_paid: '30.000' },
  ]);
});

it.each([
  [0, 'FREE', 'package_session_slots_ordinal_range'],
  [4, 'FREE', 'package_session_slots_ordinal_range'],
  [2, 'IMPORTED_USED', 'package_session_slots_initial_state'],
])('a mixed slot batch rejects ordinal %s and state %s', async (ordinal, state, constraint) => {
  const parent = nextId();
  const component = nextId();
  await rejected(
    db.withTenant(A.company, async (tx) => {
      await tx.execute(entitlementInsert(parent));
      await tx.execute(componentInsert(component, parent));
      await tx.execute(sql`INSERT INTO package_session_slots
      (company_id,id,business_id,entitlement_id,component_id,ordinal,unit_value,state)
      VALUES (${A.company},${nextId()},${A.business},${parent},${component},1,'10.000','FREE'),
        (${A.company},${nextId()},${A.business},${parent},${component},${Number(ordinal)},'10.000',${String(state)})`);
    }),
    '23514',
    String(constraint),
  );
  expect(await owner`SELECT id FROM package_entitlements WHERE id=${parent}`).toHaveLength(0);
});

it('a mixed component batch checks each component own ordinal range', async () => {
  const parent = nextId();
  const first = nextId();
  const second = nextId();
  await rejected(
    db.withTenant(A.company, async (tx) => {
      await tx.execute(entitlementInsert(parent));
      await tx.execute(componentInsert(first, parent));
      await tx.execute(
        componentInsert(second, parent, {
          serviceId: SECOND_SERVICE,
          position: 2,
          sessions: 1,
          value: '0.000',
        }),
      );
      await tx.execute(sql`INSERT INTO package_session_slots
      (company_id,id,business_id,entitlement_id,component_id,ordinal,unit_value,state)
      VALUES (${A.company},${nextId()},${A.business},${parent},${first},3,'10.000','FREE'),
        (${A.company},${nextId()},${A.business},${parent},${second},2,'0.000','FREE')`);
    }),
    '23514',
    'package_session_slots_ordinal_range',
  );
});

it('a mixed parent batch preserves every creation seal', async () => {
  const sealed = nextId();
  const sealedComponent = nextId();
  await compose(sealed, [{ id: sealedComponent, slots: [1, 2, 3] }]);
  const parent = nextId();
  const component = nextId();
  await rejected(
    db.withTenant(A.company, async (tx) => {
      await tx.execute(entitlementInsert(parent));
      await tx.execute(componentInsert(component, parent));
      await tx.execute(sql`INSERT INTO package_session_slots
      (company_id,id,business_id,entitlement_id,component_id,ordinal,unit_value,state)
      VALUES (${A.company},${nextId()},${A.business},${parent},${component},1,'10.000','FREE'),
        (${A.company},${nextId()},${A.business},${sealed},${sealedComponent},4,'10.000','FREE')`);
    }),
    '23514',
    'package_session_slots_creation_seal',
  );
  expect(await owner`SELECT id FROM package_entitlements WHERE id=${parent}`).toHaveLength(0);
  expect(
    await owner`SELECT id FROM package_session_slots WHERE entitlement_id=${sealed}`,
  ).toHaveLength(3);
});
