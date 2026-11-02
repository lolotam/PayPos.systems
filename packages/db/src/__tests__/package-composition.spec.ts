import { sql } from 'drizzle-orm';
import postgres from 'postgres';
import { afterAll, beforeAll, expect, it } from 'vitest';

import { ORDER_IDS, seedOrders } from '../../test/orders-fixture.ts';
import { createTestDatabase, type TestDatabase } from '../../test/test-database.ts';
import { seedTwoTenants, TENANT, USER } from '../../test/tenancy-fixtures.ts';
import { createDatabase, type Database } from '../index.ts';

const { A, B } = TENANT;
const PACKAGE_TYPE = '01920000-0000-7000-8000-00000000f301';
const SECOND_SERVICE = '01920000-0000-7000-8000-00000000f302';
const FILE = '01920000-0000-7000-8000-00000000f303';
const PREVIEW = '01920000-0000-7000-8000-00000000f304';
const SALE = '01920000-0000-7000-8000-00000000f305';
const SALE_COMPONENT = '01920000-0000-7000-8000-00000000f306';

let testDb: TestDatabase;
let owner: postgres.Sql;
let db: Database;
let serial = 0;

beforeAll(async () => {
  testDb = await createTestDatabase();
  await seedTwoTenants(testDb.ownerUrl);
  owner = postgres(testDb.ownerUrl, { max: 1, onnotice: () => undefined });
  await seedOrders(owner);
  await owner`INSERT INTO package_types(company_id,id,business_id,name_en,price,validity_days)
    VALUES (${A.company},${PACKAGE_TYPE},${A.business},'Synthetic package',30.000,30)`;
  await owner`INSERT INTO services(company_id,id,business_id,name_en,price,commission_rule_kind)
    VALUES (${A.company},${SECOND_SERVICE},${A.business},'Second synthetic service',10.000,'ZERO')`;
  await owner`INSERT INTO file_objects(company_id,id,business_id,owner_module,owner_entity_id,staging_key,
    content_type,size_bytes,required_permission,created_by,created_at)
    VALUES (${A.company},${FILE},${A.business},'import',${FILE},'synthetic-import-file','application/pdf',10,
    'read:files:business',${USER},now())`;
  await owner`INSERT INTO import_previews(company_id,id,business_id,entity,file_id,created_by,created_at,
    expires_at,row_count,error_count,rows,errors)
    VALUES (${A.company},${PREVIEW},${A.business},'packages',${FILE},${USER},now(),now() + interval '1 day',1,0,'[]'::jsonb,'[]'::jsonb)`;
  db = createDatabase({ url: testDb.appUrl, ids: { newId: () => nextId() } });
});

afterAll(async () => {
  await db?.close();
  await owner?.end();
  await testDb?.drop();
});

function nextId(): string {
  serial += 1;
  return `01920000-0000-7000-8000-00000000f${serial.toString(16).padStart(3, '0')}`;
}

type Failure = { code?: string; constraint_name?: string; cause?: Failure };

const detail = (error: unknown) => {
  const failure = error as Failure;
  return {
    code: failure?.code ?? failure?.cause?.code,
    constraint: failure?.constraint_name ?? failure?.cause?.constraint_name,
  };
};

async function rejected(work: Promise<unknown>, code: string, constraint?: string): Promise<void> {
  const error = await work.then(
    () => null,
    (caught: unknown) => caught,
  );
  expect(error).toBeInstanceOf(Error);
  const found = detail(error);
  if (constraint === undefined) {
    expect(found.code).toBe(code);
    return;
  }
  expect([found.code, found.constraint]).toEqual([code, constraint]);
}

interface EntitlementOptions {
  provenance?: 'SOLD' | 'IMPORTED';
  pricePaid?: string;
  externalRef?: string;
  importRow?: number;
}

const entitlementInsert = (id: string, o: EntitlementOptions = {}) => {
  const sold = o.provenance !== 'IMPORTED';
  return sql`
    INSERT INTO package_entitlements
      (company_id,id,business_id,customer_id,package_type_id,provenance,name_en,validity_days,list_price,
       price_paid,discount,discount_bps,paid_method,seller_employee_id,sold_branch_id,sold_at,
       sold_business_date,sold_timezone,recorded_by,recorded_by_membership_id,external_ref,import_batch_id,
       import_row,expires_on)
    VALUES (${A.company},${id},${A.business},${ORDER_IDS.customer},
      ${sold ? PACKAGE_TYPE : null},${sold ? 'SOLD' : 'IMPORTED'},'Synthetic package',30,
      ${sold ? '30.000' : null},${o.pricePaid ?? '30.000'},${sold ? '0.000' : null},0,
      ${sold ? 'CASH' : null},${sold ? ORDER_IDS.employee : null},${sold ? A.branch : null},
      ${sold ? sql`now()` : null},${sold ? sql`current_date` : null},${sold ? 'Asia/Kuwait' : null},
      ${USER},${ORDER_IDS.membership},
      ${sold ? null : (o.externalRef ?? 'EXT-C')},${sold ? null : PREVIEW},${sold ? null : (o.importRow ?? 1)},
      current_date + 30)`;
};

interface ComponentOptions {
  value?: string;
  sessions?: number;
  serviceId?: string;
  position?: number;
}

const componentInsert = (id: string, entitlementId: string, o: ComponentOptions = {}) => sql`
  INSERT INTO package_components
    (company_id,id,business_id,entitlement_id,service_id,position,name_en,list_price_snapshot,sessions_total,component_value)
  VALUES (${A.company},${id},${A.business},${entitlementId},${o.serviceId ?? ORDER_IDS.service},
    ${o.position ?? 1},'Synthetic service',10.000,${o.sessions ?? 3},${o.value ?? '30.000'})`;

interface SlotOptions {
  value?: string;
  state?: string;
}

const slotInsert = (
  id: string,
  entitlementId: string,
  componentId: string,
  ordinal: number,
  o: SlotOptions = {},
) => sql`
  INSERT INTO package_session_slots
    (company_id,id,business_id,entitlement_id,component_id,ordinal,unit_value,state)
  VALUES (${A.company},${id},${A.business},${entitlementId},${componentId},${ordinal},
    ${o.value ?? '10.000'},${o.state ?? 'FREE'})`;

/** محاولة كتابة واحدة: الـ transaction بيرجع خطأها زي ما هو. */
const attempt = (statement: ReturnType<typeof sql>) =>
  db.withTenant(A.company, (tx) => tx.execute(statement));

interface Composition {
  id: string;
  options?: ComponentOptions;
  slots: number[];
  states?: string[];
}

/** تركيب كامل: الاستحقاق ومكوّناته وجلساته؛ الفحص بيحصل عند الالتزام. */
async function compose(
  entitlementId: string,
  components: Composition[],
  o: EntitlementOptions = {},
): Promise<void> {
  await db.withTenant(A.company, async (tx) => {
    await tx.execute(entitlementInsert(entitlementId, o));
    for (const component of components) {
      await tx.execute(componentInsert(component.id, entitlementId, component.options));
    }
    for (const component of components) {
      for (const [index, ordinal] of component.slots.entries()) {
        await tx.execute(
          slotInsert(nextId(), entitlementId, component.id, ordinal, {
            state: component.states?.[index] ?? 'FREE',
          }),
        );
      }
    }
  });
}

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
