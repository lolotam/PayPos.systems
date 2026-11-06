import { sql } from 'drizzle-orm';
import postgres from 'postgres';
import { afterAll, beforeAll, expect } from 'vitest';

import { ORDER_IDS, seedOrders } from '../../test/orders-fixture.ts';
import { createTestDatabase, type TestDatabase } from '../../test/test-database.ts';
import { seedTwoTenants, TENANT, USER } from '../../test/tenancy-fixtures.ts';
import { createDatabase, type Database } from '../index.ts';

export const { A, B } = TENANT;
const PACKAGE_TYPE = '01920000-0000-7000-8000-00000000f301';
export const SECOND_SERVICE = '01920000-0000-7000-8000-00000000f302';
const FILE = '01920000-0000-7000-8000-00000000f303';
const PREVIEW = '01920000-0000-7000-8000-00000000f304';
export const SALE = '01920000-0000-7000-8000-00000000f305';
export const SALE_COMPONENT = '01920000-0000-7000-8000-00000000f306';

let testDb: TestDatabase;
export let owner: postgres.Sql;
export let db: Database;
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

export function nextId(): string {
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

export async function rejected(
  work: Promise<unknown>,
  code: string,
  constraint?: string,
): Promise<void> {
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

export const entitlementInsert = (id: string, o: EntitlementOptions = {}) => {
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

export const componentInsert = (id: string, entitlementId: string, o: ComponentOptions = {}) => sql`
  INSERT INTO package_components
    (company_id,id,business_id,entitlement_id,service_id,position,name_en,list_price_snapshot,sessions_total,component_value)
  VALUES (${A.company},${id},${A.business},${entitlementId},${o.serviceId ?? ORDER_IDS.service},
    ${o.position ?? 1},'Synthetic service',10.000,${o.sessions ?? 3},${o.value ?? '30.000'})`;

interface SlotOptions {
  value?: string;
  state?: string;
}

export const slotInsert = (
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
export const attempt = (statement: ReturnType<typeof sql>) =>
  db.withTenant(A.company, (tx) => tx.execute(statement));

interface Composition {
  id: string;
  options?: ComponentOptions;
  slots: number[];
  states?: string[];
}

/** تركيب كامل: الاستحقاق ومكوّناته وجلساته؛ الفحص بيحصل عند الالتزام. */
export async function compose(
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
