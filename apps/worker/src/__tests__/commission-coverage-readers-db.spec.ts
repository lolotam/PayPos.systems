import { createDatabase, type Database } from '@pospay/db';
import { systemUuidV7 } from '@pospay/ids';
import { sql, type SQL } from 'drizzle-orm';
import postgres from 'postgres';
import { afterAll, afterEach, beforeAll, expect, it } from 'vitest';

import {
  COMMISSION_LINE_IDS,
  COMMISSION_LINE_TENANTS,
  seedCommissionLineTenants,
} from '../../../../packages/db/test/commission-line-fixtures.ts';
import {
  createTestDatabase,
  type TestDatabase,
} from '../../../../packages/db/test/test-database.ts';
import { USER } from '../../../../packages/db/test/tenancy-fixtures.ts';
import {
  createCoverageProjectionReader,
  markedEventIdsStatement,
  projectedLineRevisionsStatement,
  projectedSaleRevisionsStatement,
  projectedSalaryRevisionsStatement,
} from '../modules/commissions/persistence/commission-coverage.reads.ts';
import {
  listCurrentPackageSales,
  packageSaleCoverageStatement,
  readServiceLineCoveragePage,
  serviceLineCoverageStatement,
} from '../modules/orders/index.ts';
import { readSalaryCoveragePage, salaryCoverageStatement } from '../modules/staff/index.ts';

let testDb: TestDatabase;
let owner: postgres.Sql;
let db: Database;
const ids = systemUuidV7();

const { A, B } = COMMISSION_LINE_TENANTS;
type Tenant = typeof A | typeof B;
const CONSUMER = 'commissions.project-inputs';
const SESSION = '01920000-0000-7000-8000-0000000f0d01';
const FIRST = '01920000-0000-7000-8000-0000000f0a01';
const SECOND = '01920000-0000-7000-8000-0000000f0a02';
const THIRD = '01920000-0000-7000-8000-0000000f0a03';
const B_LINE = '01920000-0000-7000-8000-0000000f0b01';
const MARKED = ids.newId();
const OTHER_CONSUMER = ids.newId();
const OTHER_COMPANY = ids.newId();
const INDEX_SCAN_TYPES = ['Index Scan', 'Index Only Scan', 'Bitmap Index Scan', 'Bitmap Heap Scan'];

interface SeededLine {
  readonly id: string;
  readonly ordinal: number;
  readonly revision: number;
  readonly status?: 'ACTIVE' | 'CANCELLED';
}

beforeAll(async () => {
  testDb = await createTestDatabase();
  await seedCommissionLineTenants(testDb.ownerUrl);
  owner = postgres(testDb.ownerUrl, { max: 1, onnotice: () => undefined });
  await owner`INSERT INTO service_sessions (company_id,id,business_id,branch_id,customer_id,
    customer_name,customer_phone_masked,recorded_by,recorded_by_membership_id,occurred_at,recorded_at,
    business_date,business_timezone,late) VALUES (${A.company},${SESSION},${A.business},${A.branch},
    ${A.customer},'Coverage customer','***123',${USER},${A.membership},now(),now(),current_date,
    'Asia/Kuwait',false),(${B.company},${SESSION},${B.business},${B.branch},${B.customer},
    'Coverage customer','***123',${USER},${B.membership},now(),now(),current_date,'Asia/Kuwait',false)`;
  await owner`UPDATE employees SET deleted_at='2026-02-01T00:00:00Z'
    WHERE company_id=${A.company} AND id=${COMMISSION_LINE_IDS.thirdEmployee}`;
  for (const tenant of [A, B])
    await owner`INSERT INTO package_types(company_id,id,business_id,name_en,price,validity_days)
      VALUES (${tenant.company},${PACKAGE_TYPE},${tenant.business},'Coverage package type',1.000,30)`;
  db = createDatabase({ url: testDb.appUrl, ids });
});

afterAll(async () => {
  await db?.close();
  await owner?.end();
  await testDb?.drop();
});

afterEach(async () => {
  // التنضيف بيحذف صف المنفذين من غير رأس تغيير مسجّل، وحرّاس الإنتاج بيطلبوا الرأس ده.
  await owner.begin(async (tx) => {
    await tx`SET LOCAL session_replication_role = replica`;
    await tx`DELETE FROM line_performers`;
    await tx`DELETE FROM service_line_cancellations`;
    await tx`DELETE FROM service_lines`;
    await tx`DELETE FROM commission_line_heads`;
    await tx`DELETE FROM commission_salaries`;
    await tx`DELETE FROM commission_sales`;
    await tx`DELETE FROM employee_salaries`;
    await tx`DELETE FROM package_session_slots`;
    await tx`DELETE FROM package_components`;
    await tx`DELETE FROM package_entitlements`;
    await tx`DELETE FROM consumed_events`;
  });
});

const readLines = (companyId: string, after: string | null, limit: number) =>
  db.withTenant(companyId, (tx) => readServiceLineCoveragePage(tx, companyId, after, limit));

async function insertServiceLine(tenant: Tenant, line: SeededLine): Promise<void> {
  const cancelled = line.status === 'CANCELLED';
  await owner.begin(async (tx) => {
    await tx`INSERT INTO service_lines (company_id,id,business_id,session_id,service_id,ordinal,
      input_index,status,revision,list_price,price,discount,net,effective_discount_bps,limit_source,
      limit_bps_applied,name_en,catalog_revision,rule_kind,counts_toward_threshold,has_performer_warning,
      recorded_by,recorded_by_membership_id,recorded_at,late) VALUES (${tenant.company},${line.id},
      ${tenant.business},${SESSION},${tenant.service},${line.ordinal},${line.ordinal - 1},'ACTIVE',
      ${cancelled ? line.revision - 1 : line.revision},1.000,1.000,0.000,1.000,0,'OWNER',NULL,
      'Coverage service',1,'ZERO',true,false,${USER},${tenant.membership},now(),false)`;
    await tx`INSERT INTO line_performers (company_id,id,business_id,line_id,employee_id,performer_ordinal,
      share_bps,name_en,not_clocked_in_warning,approved_leave_warning) VALUES (${tenant.company},
      ${ids.newId()},${tenant.business},${line.id},${tenant.employee},1,10000,'Coverage performer',false,false)`;
    if (cancelled) {
      await tx`UPDATE service_lines SET status='CANCELLED', revision=${line.revision}
        WHERE company_id=${tenant.company} AND id=${line.id}`;
      await tx`INSERT INTO service_line_cancellations(company_id,id,business_id,line_id,revision,previous_revision,previous_price,previous_discount,previous_net,
        cancelled_by,cancelled_by_membership_id,cancelled_at,reason,canceller_name_en)
        SELECT company_id,${ids.newId()},business_id,id,revision,revision-1,price,discount,net,${USER},${tenant.membership},now(),'Synthetic reversal','Synthetic recorder'
        FROM service_lines WHERE company_id=${tenant.company} AND id=${line.id}`;
    }
  });
}

async function insertEmployeeSalary(
  tenant: Tenant,
  employeeId: string,
  effectiveFrom: string,
  revision: number,
): Promise<void> {
  await owner`INSERT INTO employee_salaries (company_id,id,business_id,employee_id,effective_from,amount,
    set_by,revision,reason) VALUES (${tenant.company},${ids.newId()},${tenant.business},${employeeId},
    ${effectiveFrom},500.000,${USER},${revision},'Coverage source seed')`;
}

async function insertHead(tenant: Tenant, lineId: string, revision: number): Promise<void> {
  await owner`INSERT INTO commission_line_heads (company_id,business_id,line_id,session_id,branch_id,
    service_id,customer_id,revision,status,business_date,period) VALUES (${tenant.company},
    ${tenant.business},${lineId},${SESSION},${tenant.branch},${tenant.service},${tenant.customer},
    ${revision},'ACTIVE','2026-11-01','2026-11')`;
}

async function insertProjectedSalary(
  tenant: Tenant,
  employeeId: string,
  effectiveFrom: string,
  revision: number,
): Promise<void> {
  await owner`INSERT INTO commission_salaries (company_id,id,business_id,employee_id,effective_from,amount,
    revision) VALUES (${tenant.company},${ids.newId()},${tenant.business},${employeeId},${effectiveFrom},
    500.000,${revision})`;
}

async function insertMark(companyId: string, consumerId: string, eventId: string): Promise<void> {
  await owner`INSERT INTO consumed_events (company_id,consumer_id,event_id) VALUES (${companyId},
    ${consumerId},${eventId})`;
}

const PACKAGE_TYPE = '01920000-0000-7000-8000-00000000f301';

/** باقة مستوردة بمعاينة استيراد حقيقية؛ سلسلة الملف والمعاينة والاستحقاق والمكوّن والجلسة. */
async function insertImportedEntitlement(tenant: Tenant, entitlementId: string): Promise<void> {
  const file = ids.newId();
  const preview = ids.newId();
  await owner`INSERT INTO file_objects(company_id,id,business_id,owner_module,owner_entity_id,
    staging_key,content_type,size_bytes,required_permission,created_by,created_at)
    VALUES (${tenant.company},${file},${tenant.business},'import',${file},'synthetic-import-file',
    'application/pdf',10,'read:files:business',${USER},now())`;
  await owner`INSERT INTO import_previews(company_id,id,business_id,entity,file_id,created_by,
    created_at,expires_at,row_count,error_count,rows,errors)
    VALUES (${tenant.company},${preview},${tenant.business},'packages',${file},${USER},now(),
    now()+interval '1 day',1,0,'[]'::jsonb,'[]'::jsonb)`;
  await db.withTenant(tenant.company, async (tx) => {
    await tx.execute(sql`INSERT INTO package_entitlements
      (company_id,id,business_id,customer_id,provenance,name_en,price_paid,recorded_by,
        recorded_by_membership_id,external_ref,import_batch_id,import_row,expires_on,
        refunded_amount,revision)
      VALUES (${tenant.company},${entitlementId},${tenant.business},${tenant.customer},'IMPORTED',
        'Coverage imported package','1.000',${USER},${tenant.membership},${'EXT-' + entitlementId},
        ${preview},1,'2026-11-30','0.000',1)`);
    await tx.execute(sql`INSERT INTO package_components
      (company_id,id,business_id,entitlement_id,service_id,position,name_en,list_price_snapshot,
        sessions_total,component_value)
      VALUES (${tenant.company},${ids.newId()},${tenant.business},${entitlementId},${tenant.service},
      1,'Coverage component',1.000,1,1.000)`);
    const component = await tx.execute<{ id: string }>(sql`
      SELECT id FROM package_components WHERE company_id=${tenant.company} AND entitlement_id=${entitlementId}`);
    await tx.execute(sql`INSERT INTO package_session_slots
      (company_id,id,business_id,entitlement_id,component_id,ordinal,unit_value,state)
      VALUES (${tenant.company},${ids.newId()},${tenant.business},${entitlementId},${component[0]?.id},
      1,1.000,'FREE')`);
  });
}

async function insertSoldEntitlement(tenant: Tenant, entitlementId: string): Promise<void> {
  // قيد سلامة التشغيل مؤجَّل حتى نهاية المعاملة، فالباكدج ومكوّنه في معاملة واحدة.
  await db.withTenant(tenant.company, async (tx) => {
    await tx.execute(sql`INSERT INTO package_entitlements
      (company_id,id,business_id,customer_id,package_type_id,provenance,name_en,validity_days,list_price,
        price_paid,discount,discount_bps,paid_method,seller_employee_id,sold_branch_id,sold_at,
        sold_business_date,sold_timezone,recorded_by,recorded_by_membership_id,expires_on,
        refunded_amount,revision)
      VALUES (${tenant.company},${entitlementId},${tenant.business},${tenant.customer},
        ${PACKAGE_TYPE},'SOLD','Coverage package',30,
        '1.000','1.000','0.000',0,'CASH',
        ${tenant.employee},${tenant.branch},now(),
        '2026-11-01','Asia/Kuwait',${USER},${tenant.membership},
        '2026-11-30','0.000',1)`);
    await tx.execute(sql`INSERT INTO package_components
      (company_id,id,business_id,entitlement_id,service_id,position,name_en,list_price_snapshot,
        sessions_total,component_value)
      VALUES (${tenant.company},${ids.newId()},${tenant.business},${entitlementId},${tenant.service},
      1,'Coverage component',1.000,1,1.000)`);
    const component = await tx.execute<{ id: string }>(sql`
      SELECT id FROM package_components WHERE company_id=${tenant.company} AND entitlement_id=${entitlementId}`);
    await tx.execute(sql`INSERT INTO package_session_slots
      (company_id,id,business_id,entitlement_id,component_id,ordinal,unit_value,state)
      VALUES (${tenant.company},${ids.newId()},${tenant.business},${entitlementId},${component[0]?.id},
      1,1.000,'FREE')`);
  });
}

async function insertProjectedSale(
  tenant: Tenant,
  saleId: string,
  revision: number,
): Promise<void> {
  await owner`INSERT INTO commission_sales (company_id,id,business_id,sale_id,branch_id,
    seller_employee_id,business_date,period,price_paid,refunded_amount,status,revision)
    VALUES (${tenant.company},${ids.newId()},${tenant.business},${saleId},${tenant.branch},
    ${tenant.employee},'2026-11-01','2026-11','1.000','0.000','SOLD',${revision})`;
}

const readSales = (companyId: string, after: string | null, limit: number) =>
  db.withTenant(companyId, (tx) => listCurrentPackageSales(tx, companyId, after, limit));

function planNodes(value: unknown): Record<string, unknown>[] {
  if (value === null || typeof value !== 'object') return [];
  if (Array.isArray(value)) return value.flatMap(planNodes);
  const node = value as Record<string, unknown>;
  return [node, ...Object.values(node).flatMap(planNodes)];
}

const COVERAGE_STATEMENTS: readonly (readonly [SQL, string])[] = [
  [serviceLineCoverageStatement(A.company, null, 10), 'service_lines'],
  [salaryCoverageStatement(A.company, null, 10), 'employee_salaries'],
  [packageSaleCoverageStatement(A.company, null, 10), 'package_entitlements'],
  [projectedLineRevisionsStatement(A.company, [FIRST]), 'commission_line_heads'],
  [projectedSaleRevisionsStatement(A.company, [FIRST]), 'commission_sales'],
  [projectedSalaryRevisionsStatement(A.company, [A.employee]), 'commission_salaries'],
  [markedEventIdsStatement(A.company, CONSUMER, [MARKED]), 'consumed_events'],
];

it('the line reader returns the tenant lines by id with numeric revisions, hides other tenants, and pages by the last id of a full page', async () => {
  await insertServiceLine(A, { id: FIRST, ordinal: 1, revision: 1 });
  await insertServiceLine(A, { id: SECOND, ordinal: 2, revision: 3, status: 'CANCELLED' });
  await insertServiceLine(A, { id: THIRD, ordinal: 3, revision: 2 });
  await insertServiceLine(B, { id: B_LINE, ordinal: 1, revision: 1 });

  const forA = await readLines(A.company, null, 50);
  const forB = await readLines(B.company, null, 50);
  expect(forA.rows).toEqual([
    { lineId: FIRST, revision: 1 },
    { lineId: SECOND, revision: 3 },
    { lineId: THIRD, revision: 2 },
  ]);
  expect(forA.nextAfter).toBeNull();
  expect(forB.rows).toEqual([{ lineId: B_LINE, revision: 1 }]);

  const first = await readLines(A.company, null, 2);
  expect(first.rows.map((row) => row.lineId)).toEqual([FIRST, SECOND]);
  expect(first.nextAfter).toBe(SECOND);

  const second = await readLines(A.company, first.nextAfter, 2);
  expect(second.rows.map((row) => row.lineId)).toEqual([THIRD]);
  expect(second.nextAfter).toBeNull();
});

it('the salary reader returns the employee, the text date and the revision of the tenant salaries and pages by the employee and date cursor', async () => {
  const readSalaries = (after: { employeeId: string; effectiveFrom: string } | null, limit: number) =>
    db.withTenant(A.company, (tx) => readSalaryCoveragePage(tx, A.company, after, limit));
  await insertEmployeeSalary(A, A.employee, '2026-01-01', 1);
  await insertEmployeeSalary(A, A.employee, '2026-03-01', 2);
  await insertEmployeeSalary(A, COMMISSION_LINE_IDS.thirdEmployee, '2026-02-01', 1);
  await insertEmployeeSalary(B, B.employee, '2026-04-01', 1);

  const all = await readSalaries(null, 50);
  expect(all.rows).toEqual([
    { employeeId: A.employee, effectiveFrom: '2026-01-01', revision: 1 },
    { employeeId: A.employee, effectiveFrom: '2026-03-01', revision: 2 },
    { employeeId: COMMISSION_LINE_IDS.thirdEmployee, effectiveFrom: '2026-02-01', revision: 1 },
  ]);
  expect(all.next).toBeNull();

  const first = await readSalaries(null, 2);
  expect(first.rows.map((row) => row.effectiveFrom)).toEqual(['2026-01-01', '2026-03-01']);
  expect(first.next).toEqual({ employeeId: A.employee, effectiveFrom: '2026-03-01' });

  const second = await readSalaries(first.next, 2);
  expect(second.rows.map((row) => row.employeeId)).toEqual([COMMISSION_LINE_IDS.thirdEmployee]);
  expect(second.next).toBeNull();
});

it('the projection reads return the head, the salary and the marked event of the tenant only, and nothing for an empty id list', async () => {
  await insertHead(A, FIRST, 5);
  await insertHead(B, B_LINE, 9);
  await insertProjectedSalary(A, A.employee, '2026-01-01', 7);
  await insertProjectedSalary(B, B.employee, '2026-04-01', 7);
  await insertMark(A.company, CONSUMER, MARKED);
  await insertMark(A.company, 'another.consumer', OTHER_CONSUMER);
  await insertMark(B.company, CONSUMER, OTHER_COMPANY);
  const projection = createCoverageProjectionReader();

  const read = await db.withTenant(A.company, async (tx) => ({
    lines: await projection.lineRevisions(tx, A.company, [FIRST, SECOND]),
    salaries: await projection.salaryRevisions(tx, A.company, [A.employee]),
    marked: await projection.markedEventIds(tx, A.company, CONSUMER, [
      MARKED,
      OTHER_CONSUMER,
      OTHER_COMPANY,
    ]),
    empty: {
      lines: await projection.lineRevisions(tx, A.company, []),
      salaries: await projection.salaryRevisions(tx, A.company, []),
      marked: await projection.markedEventIds(tx, A.company, CONSUMER, []),
    },
  }));

  expect(read.lines).toEqual([{ lineId: FIRST, revision: 5 }]);
  expect(read.salaries).toEqual([
    { employeeId: A.employee, effectiveFrom: '2026-01-01', revision: 7 },
  ]);
  expect([...read.marked]).toEqual([MARKED]);
  expect(read.empty.lines).toEqual([]);
  expect(read.empty.salaries).toEqual([]);
  expect([...read.empty.marked]).toEqual([]);
});

it('the sale reader returns the tenant sold entitlements with numeric revisions, hides imports and other tenants, and pages by the last id', async () => {
  await insertSoldEntitlement(A, FIRST);
  await insertSoldEntitlement(A, SECOND);
  await insertImportedEntitlement(A, THIRD);
  await insertSoldEntitlement(B, B_LINE);

  const forA = await readSales(A.company, null, 50);
  const forB = await readSales(B.company, null, 50);
  expect(forA.rows).toEqual([
    { saleId: FIRST, revision: 1 },
    { saleId: SECOND, revision: 1 },
  ]);
  expect(forA.nextAfter).toBeNull();
  expect(forB.rows).toEqual([{ saleId: B_LINE, revision: 1 }]);

  const first = await readSales(A.company, null, 1);
  expect(first.rows.map((row) => row.saleId)).toEqual([FIRST]);
  expect(first.nextAfter).toBe(FIRST);

  const second = await readSales(A.company, first.nextAfter, 1);
  expect(second.rows.map((row) => row.saleId)).toEqual([SECOND]);
  // الصفحة الكاملة بترجّع مؤشر دايماً حتى لو التالي فاضي؛ النهاية بتتعرف بصفحة فارية.
  expect(second.nextAfter).toBe(SECOND);

  const third = await readSales(A.company, second.nextAfter, 1);
  expect(third.rows).toEqual([]);
  expect(third.nextAfter).toBeNull();
});

it('the sale projection read returns the tenant sale rows only and nothing for an empty id list', async () => {
  await insertProjectedSale(A, FIRST, 3);
  await insertProjectedSale(B, B_LINE, 7);
  const projection = createCoverageProjectionReader();

  const read = await db.withTenant(A.company, async (tx) => ({
    sales: await projection.saleRevisions(tx, A.company, [FIRST, SECOND]),
    empty: await projection.saleRevisions(tx, A.company, []),
  }));

  expect(read.sales).toEqual([{ saleId: FIRST, revision: 3 }]);
  expect(read.empty).toEqual([]);
});

it('the coverage statements refuse a page limit outside the allowed range', () => {
  for (const limit of [0, 501]) {
    expect(() => serviceLineCoverageStatement(A.company, null, limit)).toThrowError(RangeError);
    expect(() => serviceLineCoverageStatement(A.company, null, limit)).toThrowError(
      'COVERAGE_PAGE_LIMIT_INVALID',
    );
    expect(() => salaryCoverageStatement(A.company, null, limit)).toThrowError(RangeError);
    expect(() => salaryCoverageStatement(A.company, null, limit)).toThrowError(
      'COVERAGE_PAGE_LIMIT_INVALID',
    );
    expect(() => packageSaleCoverageStatement(A.company, null, limit)).toThrowError(RangeError);
    expect(() => packageSaleCoverageStatement(A.company, null, limit)).toThrowError(
      'COVERAGE_PAGE_LIMIT_INVALID',
    );
  }
});

it('the coverage statements plan on indexes and never on a sequential scan', async () => {
  await insertHead(A, FIRST, 5);
  await insertSoldEntitlement(A, FIRST);
  await insertProjectedSale(A, FIRST, 5);

  const plans = await db.withTenant(A.company, async (tx) => {
    await tx.execute(sql`SET LOCAL enable_seqscan=off`);
    const planned: [string, unknown][] = [];
    for (const [statement, table] of COVERAGE_STATEMENTS) {
      planned.push([table, await tx.execute(sql`EXPLAIN (ANALYZE, FORMAT JSON) ${statement}`)]);
    }
    return planned;
  });

  for (const [table, plan] of plans) {
    const nodes = planNodes(plan);
    expect(
      nodes.some((node) => node['Relation Name'] === table && node['Node Type'] === 'Seq Scan'),
    ).toBe(false);
    expect(
      nodes.some(
        (node) =>
          INDEX_SCAN_TYPES.includes(String(node['Node Type'])) &&
          (node['Relation Name'] === table || String(node['Index Name'] ?? '').includes(table)),
      ),
    ).toBe(true);
  }
});
