import postgres from 'postgres';
import { createDatabase, type TenantWrappers } from '@pospay/db';
import { employeeNameMatchKey } from '@pospay/domain';
import { systemUuidV7 } from '@pospay/ids';
import { createTestDatabase } from '../../../../../../packages/db/test/test-database.ts';
import { ORDER_IDS, seedOrders } from '../../../../../../packages/db/test/orders-fixture.ts';
import {
  seedTwoTenants,
  TENANT,
  USER,
} from '../../../../../../packages/db/test/tenancy-fixtures.ts';
import { packageSaleTransactions } from '../persistence/package-sale.transactions.ts';
import { ExecutePackageSale } from '../use-cases/execute-package-sale/execute-package-sale.ts';

// لحظة التسجيل الثابتة لكل الطلبات؛ نافذة البيع تُقاس منها مش من ساعة التنفيذ.
const RECORDED_AT = '2026-11-05T12:00:00Z';
const TIMEOUT_MS = 30_000;
const SELLER_NAME = 'Synthetic package seller';

let employeeNumber = 900_000;
let phoneSequence = 0;
let typeSequence = 0;

export type SeededService = {
  readonly service_id: string;
  readonly revision: number;
  readonly price: string;
};

export type SeededType = {
  readonly typeId: string;
  readonly revision: number;
  readonly services: readonly SeededService[];
};

export type SeedTypeOptions = {
  readonly price: string;
  readonly validityDays: number;
  readonly components: readonly { readonly sessions: number; readonly price?: string }[];
  readonly businessId?: string;
};

export type SellerOptions = {
  readonly hireDate?: string;
  readonly contractEnd?: string | null;
  readonly deleted?: boolean;
  readonly detachedOn?: string | null;
  readonly linkedUserId?: string | null;
};

export type ServiceRevision = { readonly service_id: string; readonly revision: number };

export type RequestOverrides = Partial<{
  type: SeededType;
  business_id: string;
  branch_id: string;
  recorded_by: string;
  recorded_by_membership_id: string;
  discount_limit_bps: number | null;
  customer_id: string;
  package_type_id: string;
  expected_type_revision: number;
  expected_service_revisions: readonly ServiceRevision[];
  price_paid: string;
  paid_method: 'CASH' | 'CARD';
  seller_employee_id: string;
  sold_at: string | null;
  recorded_at: string;
}>;

export type SaleRequestState = {
  readonly id: string;
  readonly status: string;
  readonly error_code: string | null;
  readonly error_details: unknown;
  readonly entitlement_id: string | null;
  readonly finished_at: Date | null;
  readonly recorded_at: Date;
  readonly sold_at: Date | null;
  readonly price_paid: string;
  readonly discount_limit_bps: number | null;
};

export type SoldEntitlement = {
  readonly id: string;
  readonly provenance: string;
  readonly list_price: string;
  readonly price_paid: string;
  readonly discount: string;
  readonly discount_bps: number;
  readonly revision: number;
  readonly refunded_amount: string;
  readonly validity_days: number;
  readonly paid_method: string;
  readonly seller_employee_id: string;
  readonly seller_linked_user_id: string | null;
  readonly sold_branch_id: string;
  readonly sold_at: Date;
  readonly sold_business_date: string;
  readonly sold_timezone: string;
  readonly late: boolean;
  readonly expires_on: string;
  readonly recorded_by: string;
  readonly recorded_by_membership_id: string;
};

export type SoldComponent = {
  readonly id: string;
  readonly entitlement_id: string;
  readonly service_id: string;
  readonly position: number;
  readonly list_price_snapshot: string;
  readonly sessions_total: number;
  readonly component_value: string;
};

export type SoldSlot = {
  readonly id: string;
  readonly component_id: string;
  readonly ordinal: number;
  readonly unit_value: string;
  readonly state: string;
};

export type SoldAudit = {
  readonly actor_user_id: string | null;
  readonly entity: string;
  readonly entity_id: string;
  readonly action: string;
};

export type SoldEvent = {
  readonly aggregate_type: string;
  readonly aggregate_id: string;
  readonly event_type: string;
  readonly payload: unknown;
};

export type SoldRows = {
  readonly entitlements: readonly SoldEntitlement[];
  readonly components: readonly SoldComponent[];
  readonly slots: readonly SoldSlot[];
  readonly audit: readonly SoldAudit[];
  readonly events: readonly SoldEvent[];
};

export type SoldCounts = {
  readonly entitlements: number;
  readonly components: number;
  readonly slots: number;
  readonly audit: number;
  readonly events: number;
};

type Scope = {
  readonly company: string;
  readonly business: string;
  readonly branch: string;
  readonly otherBusiness: string;
  readonly inactiveBranch: string;
  readonly seller: string;
  readonly customer: string;
  readonly otherCustomer: string;
};

type SellerScope = { readonly company: string; readonly business: string; readonly branch: string };

function nextEmployeeNumber(): number {
  employeeNumber += 1;
  if (employeeNumber > 999_999) throw new Error('PACKAGE_SALE_FIXTURE_EMPLOYEE_NUMBERS_EXHAUSTED');
  return employeeNumber;
}

function nextPhone(): string {
  phoneSequence += 1;
  return `+999${String(phoneSequence).padStart(8, '0')}`;
}

function serviceId(type: SeededType, index: number): string {
  const service = type.services[index];
  if (service === undefined) throw new Error('PACKAGE_SALE_FIXTURE_SERVICE_MISSING');
  return service.service_id;
}

async function seedCustomer(
  owner: postgres.Sql,
  ids: ReturnType<typeof systemUuidV7>,
  companyId: string,
  name: string,
): Promise<string> {
  const id = ids.newId();
  await owner`INSERT INTO customers(company_id,id,name,phone,locale,created_at,updated_at)
    VALUES(${companyId},${id},${name},${nextPhone()},'en',now(),now())`;
  return id;
}

async function seedSeller(
  owner: postgres.Sql,
  ids: ReturnType<typeof systemUuidV7>,
  scope: SellerScope,
  options: SellerOptions = {},
): Promise<string> {
  const id = ids.newId();
  const linkedUserId = options.linkedUserId === undefined ? ids.newId() : options.linkedUserId;
  if (linkedUserId !== null)
    await owner`INSERT INTO "user"(id,name,email)
      VALUES(${linkedUserId},${SELLER_NAME},${`seller-${linkedUserId}@example.test`})
      ON CONFLICT(id) DO NOTHING`;
  await owner`INSERT INTO employees(company_id,id,business_id,primary_branch_id,user_id,name_en,name_en_key,
    role_code,hire_date,contract_end,deleted_at,employee_number)
    VALUES(${scope.company},${id},${scope.business},${scope.branch},${linkedUserId},${SELLER_NAME},
      ${employeeNameMatchKey(SELLER_NAME)},'staff',${options.hireDate ?? '2026-01-01'},
      ${options.contractEnd ?? null},${options.deleted === true ? new Date(RECORDED_AT) : null},
      ${nextEmployeeNumber()})`;
  await owner`INSERT INTO employee_branches(company_id,id,business_id,employee_id,branch_id,"from","to")
    VALUES(${scope.company},${ids.newId()},${scope.business},${id},${scope.branch},'2026-01-01',
      ${options.detachedOn ?? null})`;
  return id;
}

async function seedWorkspace(
  owner: postgres.Sql,
  ids: ReturnType<typeof systemUuidV7>,
): Promise<Scope> {
  const { company, business, branch } = TENANT.A;
  const otherBusiness = ids.newId();
  const inactiveBranch = ids.newId();
  await owner`INSERT INTO businesses(id,company_id,vertical_type,name_en)
    VALUES(${otherBusiness},${company},'salon','Synthetic second business')`;
  await owner`INSERT INTO branches(id,company_id,business_id,name_en)
    VALUES(${inactiveBranch},${company},${business},'Synthetic inactive branch')`;
  const seller = await seedSeller(owner, ids, { company, business, branch });
  const customer = await seedCustomer(owner, ids, company, 'Synthetic sale customer');
  const otherCustomer = await seedCustomer(
    owner,
    ids,
    TENANT.B.company,
    'Synthetic other customer',
  );
  return {
    company,
    business,
    branch,
    otherBusiness,
    inactiveBranch,
    seller,
    customer,
    otherCustomer,
  };
}

async function seedType(
  owner: postgres.Sql,
  ids: ReturnType<typeof systemUuidV7>,
  scope: Scope,
  options: SeedTypeOptions,
): Promise<SeededType> {
  const businessId = options.businessId ?? scope.business;
  const typeId = ids.newId();
  typeSequence += 1;
  await owner`INSERT INTO package_types(company_id,id,business_id,name_en,price,validity_days,revision)
    VALUES(${scope.company},${typeId},${businessId},${`Synthetic package ${typeSequence}`},${options.price},
      ${options.validityDays},1)`;
  const services: SeededService[] = [];
  for (const [index, component] of options.components.entries()) {
    const componentServiceId = ids.newId();
    const price = component.price ?? options.price;
    await owner`INSERT INTO services(company_id,id,business_id,name_en,price,commission_rule_kind,revision)
      VALUES(${scope.company},${componentServiceId},${businessId},${`Synthetic package service ${typeSequence}-${index + 1}`},
        ${price},'ZERO',1)`;
    await owner`INSERT INTO package_type_components(company_id,id,package_type_id,business_id,service_id,sessions,position)
      VALUES(${scope.company},${ids.newId()},${typeId},${businessId},${componentServiceId},${component.sessions},${index + 1})`;
    services.push({ service_id: componentServiceId, revision: 1, price });
  }
  return { typeId, revision: 1, services };
}

async function insertRequest(
  owner: postgres.Sql,
  ids: ReturnType<typeof systemUuidV7>,
  scope: Scope,
  overrides: RequestOverrides = {},
): Promise<string> {
  const type = overrides.type;
  const expected =
    overrides.expected_service_revisions ??
    type?.services.map((service) => ({
      service_id: service.service_id,
      revision: service.revision,
    }));
  if (expected === undefined || expected.length === 0)
    throw new Error('PACKAGE_SALE_FIXTURE_QUOTE_REQUIRED');
  const id = ids.newId();
  const customerId =
    overrides.customer_id ?? (await seedCustomer(owner, ids, scope.company, 'Synthetic buyer'));
  await owner`INSERT INTO package_sale_requests ${owner({
    company_id: scope.company,
    id,
    business_id: overrides.business_id ?? scope.business,
    branch_id: overrides.branch_id ?? scope.branch,
    recorded_by: overrides.recorded_by ?? USER,
    recorded_by_membership_id: overrides.recorded_by_membership_id ?? ORDER_IDS.membership,
    discount_limit_bps:
      overrides.discount_limit_bps === undefined ? 1000 : overrides.discount_limit_bps,
    customer_id: customerId,
    package_type_id: overrides.package_type_id ?? type?.typeId ?? ids.newId(),
    expected_type_revision: overrides.expected_type_revision ?? type?.revision ?? 1,
    expected_service_revisions: owner.json(expected),
    price_paid: overrides.price_paid ?? '25.000',
    paid_method: overrides.paid_method ?? 'CASH',
    seller_employee_id: overrides.seller_employee_id ?? scope.seller,
    sold_at: overrides.sold_at ?? null,
    recorded_at: overrides.recorded_at ?? RECORDED_AT,
    status: 'pending',
  })}`;
  return id;
}

async function readState(owner: postgres.Sql, requestId: string): Promise<SaleRequestState> {
  const [row] = await owner<
    SaleRequestState[]
  >`SELECT id,status,error_code,error_details,entitlement_id,
    finished_at,recorded_at,sold_at,price_paid::text,discount_limit_bps
    FROM package_sale_requests WHERE id=${requestId}`;
  if (row === undefined) throw new Error('PACKAGE_SALE_FIXTURE_REQUEST_MISSING');
  return row;
}

async function readSold(owner: postgres.Sql, requestId: string): Promise<SoldRows> {
  const [request] = await owner<
    { company_id: string; package_type_id: string; customer_id: string }[]
  >`
      SELECT company_id,package_type_id,customer_id FROM package_sale_requests WHERE id=${requestId}`;
  if (request === undefined) throw new Error('PACKAGE_SALE_FIXTURE_REQUEST_MISSING');
  const entitlements = await owner<
    SoldEntitlement[]
  >`SELECT id,provenance,list_price::text,price_paid::text,
    discount::text,discount_bps,revision,refunded_amount::text,validity_days,paid_method,seller_employee_id,
    seller_linked_user_id,sold_branch_id,sold_at,sold_business_date::text,sold_timezone,late,expires_on::text,
    recorded_by,recorded_by_membership_id
    FROM package_entitlements
    WHERE company_id=${request.company_id} AND package_type_id=${request.package_type_id}
      AND customer_id=${request.customer_id}`;
  if (entitlements.length === 0)
    return { entitlements: [], components: [], slots: [], audit: [], events: [] };
  const ids = entitlements.map((entitlement) => entitlement.id);
  const components = await owner<SoldComponent[]>`SELECT id,entitlement_id,service_id,position,
    list_price_snapshot::text,sessions_total,component_value::text FROM package_components
    WHERE entitlement_id = ANY(${ids}::uuid[]) ORDER BY position`;
  const slots = await owner<
    SoldSlot[]
  >`SELECT s.id,s.component_id,s.ordinal,s.unit_value::text,s.state
    FROM package_session_slots s JOIN package_components c ON c.company_id=s.company_id AND c.id=s.component_id
    WHERE s.entitlement_id = ANY(${ids}::uuid[]) ORDER BY c.position,s.ordinal`;
  const audit = await owner<SoldAudit[]>`SELECT actor_user_id,entity,entity_id,action FROM audit_log
    WHERE entity='package_entitlement' AND entity_id = ANY(${ids}::uuid[])`;
  const events = await owner<
    SoldEvent[]
  >`SELECT aggregate_type,aggregate_id,event_type,payload FROM outbox
    WHERE aggregate_id = ANY(${ids}::uuid[]) AND event_type='PackageSaleChanged'`;
  return { entitlements, components, slots, audit, events };
}

async function readCounts(owner: postgres.Sql, companyId: string): Promise<SoldCounts> {
  const [row] = await owner<SoldCounts[]>`SELECT
    (SELECT count(*)::int FROM package_entitlements WHERE company_id=${companyId}) AS entitlements,
    (SELECT count(*)::int FROM package_components WHERE company_id=${companyId}) AS components,
    (SELECT count(*)::int FROM package_session_slots WHERE company_id=${companyId}) AS slots,
    (SELECT count(*)::int FROM audit_log WHERE company_id=${companyId}) AS audit,
    (SELECT count(*)::int FROM outbox WHERE company_id=${companyId}) AS events`;
  return row ?? { entitlements: 0, components: 0, slots: 0, audit: 0, events: 0 };
}

export async function packageSaleFixture() {
  const testDb = await createTestDatabase();
  await seedTwoTenants(testDb.ownerUrl);
  const owner = postgres(testDb.ownerUrl, { max: 6, onnotice: () => undefined });
  const ids = systemUuidV7();
  const db = createDatabase({ url: testDb.appUrl, ids });
  await seedOrders(owner);
  const scope = await seedWorkspace(owner, ids);
  let instant = new Date(RECORDED_AT);
  const clock = {
    now: () => new Date(instant.getTime()),
    setNow: (at: Date) => {
      instant = at;
    },
  };
  const database: Pick<TenantWrappers, 'withTenant'> = db;
  return {
    db,
    database,
    owner,
    ids,
    clock,
    company: scope.company,
    business: scope.business,
    branch: scope.branch,
    otherBusiness: scope.otherBusiness,
    inactiveBranch: scope.inactiveBranch,
    otherCompany: TENANT.B.company,
    recorder: USER,
    membership: ORDER_IDS.membership,
    seller: scope.seller,
    customer: scope.customer,
    otherCustomer: scope.otherCustomer,
    seedType: (options: SeedTypeOptions) => seedType(owner, ids, scope, options),
    serviceId: (type: SeededType, index: number) => serviceId(type, index),
    sellerWith: (options: SellerOptions) => seedSeller(owner, ids, scope, options),
    request: (overrides: RequestOverrides = {}) => insertRequest(owner, ids, scope, overrides),
    worker: (options: { timeoutMs?: number } = {}) =>
      new ExecutePackageSale(
        packageSaleTransactions(database, ids, { timeoutMs: options.timeoutMs ?? TIMEOUT_MS }),
        ids,
        clock,
      ),
    state: (requestId: string) => readState(owner, requestId),
    sold: (requestId: string) => readSold(owner, requestId),
    counts: () => readCounts(owner, scope.company),
    close: async () => {
      await db.close();
      await owner.end();
      await testDb.drop();
    },
  };
}

export type PackageSaleFixture = Awaited<ReturnType<typeof packageSaleFixture>>;
