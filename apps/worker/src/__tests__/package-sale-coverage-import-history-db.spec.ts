import { createDatabase, type Database } from '@pospay/db';
import { systemUuidV7 } from '@pospay/ids';
import { sql } from 'drizzle-orm';
import postgres from 'postgres';
import { afterAll, afterEach, beforeAll, expect, it } from 'vitest';

import {
  COMMISSION_LINE_TENANTS,
  seedCommissionLineTenants,
  type CommissionLineTenant,
} from '../../../../packages/db/test/commission-line-fixtures.ts';
import {
  createTestDatabase,
  type TestDatabase,
} from '../../../../packages/db/test/test-database.ts';
import { USER } from '../../../../packages/db/test/tenancy-fixtures.ts';
import { listCurrentPackageSales, packageSaleCoverageStatement } from '../modules/orders/index.ts';
let testDb: TestDatabase;
let owner: postgres.Sql;
let db: Database;
const ids = systemUuidV7();
const { A, B } = COMMISSION_LINE_TENANTS;

const PACKAGE_TYPE = '01920000-0000-7000-8000-00000000f501';
/** صفحات الاستيراد لكل مستأجر؛ لواحقها الزوجية عشان ما تزاحمش لواحق البيع الفردية. */
const IMPORTED_ROWS = 1500;
/** باقات شركة تانية مباعة: الجدول في الإنتاج فيه غالطة مباعة مش بس مستوردة. */
const OTHER_SOLD_ROWS = 10_000;
/** لواحق معرّفات صفحات البيع: في بداية مساحة المعرّفات ووسطها وآخرها. */
const SOLD_SUFFIXES = [1, 3, 5, 7, 499, 501, 503, 505, 2995, 2997, 2999, 3001];
const INDEX_SCAN_TYPES = ['Index Scan', 'Index Only Scan', 'Bitmap Index Scan'];

/** عقدة خطة واحدة: JSON الـ EXPLING بيتقرا بالمفتاح، فالنوع عام ومقروء بالاسم. */
type PlanNode = Record<string, string | number | undefined>;

beforeAll(async () => {
  testDb = await createTestDatabase();
  await seedCommissionLineTenants(testDb.ownerUrl);
  owner = postgres(testDb.ownerUrl, { max: 1, onnotice: () => undefined });
  db = createDatabase({ url: testDb.appUrl, ids });
  for (const tenant of [A, B]) {
    await owner`INSERT INTO package_types(company_id,id,business_id,name_en,price,validity_days)
      VALUES (${tenant.company},${PACKAGE_TYPE},${tenant.business},'Import history package type',1.000,30)`;
  }
});

afterAll(async () => {
  await db?.close();
  await owner?.end();
  await testDb?.drop();
});

afterEach(async () => {
  await owner.begin(async (tx) => {
    await tx`SET LOCAL session_replication_role = replica`;
    await tx`DELETE FROM package_entitlements`;
    await tx`DELETE FROM import_previews`;
    await tx`DELETE FROM file_objects`;
  });
});

/** معرّف صف الباقة من لاحقة-hex، فترتيب المعرّفات هو ترتيب الفتحات. */
const entitlementId = (prefix: string, suffix: number) =>
  `${prefix}${suffix.toString(16).padStart(12, '0')}`;

/** معاينات استيراد: سطر الاستيراد واحد لكل معاينة، فالمعاينة الواحدة بتغطي 500 سطر. */
async function seedImportPreviews(tenant: CommissionLineTenant, count: number): Promise<string[]> {
  const file = ids.newId();
  await owner`INSERT INTO file_objects(company_id,id,business_id,owner_module,owner_entity_id,
    staging_key,content_type,size_bytes,required_permission,created_by,created_at)
    VALUES (${tenant.company},${file},${tenant.business},'import',${file},'synthetic-import-file',
    'application/pdf',10,'read:files:business',${USER},now())`;
  const previews: string[] = [];
  for (let index = 0; index < count; index += 1) {
    const preview = ids.newId();
    previews.push(preview);
    await owner`INSERT INTO import_previews(company_id,id,business_id,entity,file_id,created_by,
      created_at,expires_at,row_count,error_count,rows,errors)
      VALUES (${tenant.company},${preview},${tenant.business},'packages',${file},${USER},now(),
      now()+interval '1 day',500,0,'[]'::jsonb,'[]'::jsonb)`;
  }
  return previews;
}

/** يزرع صفحات استيراد للمستأجر؛ لواحق المعرّفات زوجية فتبقى مرتبة زي المفتاح. */
async function seedImportedRows(
  tenant: CommissionLineTenant,
  prefix: string,
  rows: number,
): Promise<void> {
  const previews = await seedImportPreviews(tenant, Math.ceil(rows / 500));
  for (const [batch, preview] of previews.entries()) {
    const size = Math.min(500, rows - batch * 500);
    const offset = batch * 500;
    if (size <= 0) break;
    await owner.begin(async (tx) => {
      // البذر بيطنش تريغرز التركيب: الصفوف هنا للقياس مش لحساب عمولة، والتركيب الكامل محتاج
      // صف مكوّن وصف جلسة لكل استحقاق، وده مش موضوع الفحص.
      await tx`SET LOCAL session_replication_role = replica`;
      await tx`INSERT INTO package_entitlements
        (company_id,id,business_id,customer_id,provenance,name_en,price_paid,recorded_by,
          recorded_by_membership_id,external_ref,import_batch_id,import_row,expires_on,
          refunded_amount,revision,created_system_id,created_txid)
        SELECT ${tenant.company},
          (${prefix}::text || lpad(to_hex(2 * (${offset}::int + i)), 12, '0'))::uuid,
          ${tenant.business}, ${tenant.customer}, 'IMPORTED', 'Coverage imported package', '1.000',
          ${USER}, ${tenant.membership}, 'EXT-' || (2 * (${offset}::int + i))::text,
          ${preview}::uuid, i, '2026-11-30', '0.000', 1,
          public.pospay_system_id(), pg_current_xact_id()
        FROM generate_series(1, ${size}) AS g(i)`;
    });
  }
}

/** يزرع باقات مباعة؛ لواحقها الفردية فتبقى متباعدة عن صفحات الاستيراد. */
async function seedSoldRows(
  tenant: CommissionLineTenant,
  prefix: string,
  suffixes: readonly number[],
): Promise<void> {
  const list = suffixes.join(',');
  await owner.begin(async (tx) => {
    await tx`SET LOCAL session_replication_role = replica`;
    await tx`INSERT INTO package_entitlements
      (company_id,id,business_id,customer_id,package_type_id,provenance,name_en,validity_days,
        list_price,price_paid,discount,discount_bps,paid_method,seller_employee_id,sold_branch_id,
        sold_at,sold_business_date,sold_timezone,recorded_by,recorded_by_membership_id,expires_on,
        refunded_amount,revision,created_system_id,created_txid)
      SELECT ${tenant.company},
        (${prefix}::text || lpad(to_hex(suffix), 12, '0'))::uuid,
        ${tenant.business}, ${tenant.customer}, ${PACKAGE_TYPE}, 'SOLD', 'Coverage sold package', 30,
        '1.000', '1.000', '0.000', 0, 'CASH', ${tenant.employee}, ${tenant.branch}, now(),
        '2024-01-01', 'Asia/Kuwait', ${USER}, ${tenant.membership}, '2024-01-31', '0.000', 1,
        public.pospay_system_id(), pg_current_xact_id()
      FROM unnest(string_to_array(${list}, ',')::int[]) AS s(suffix)`;
  });
}

/** يحلّل شجرة الخطة كلها؛ عقدة جدول الباقات هي اللي بتقيس القراءة. */
function planNodes(value: unknown): PlanNode[] {
  if (value === null || typeof value !== 'object') return [];
  if (Array.isArray(value)) return value.flatMap(planNodes);
  const node = value as Record<string, unknown>;
  return [node as PlanNode, ...Object.values(node).flatMap(planNodes)];
}

function rootPlan(result: unknown): PlanNode {
  const rows = result as Record<string, unknown>[];
  const raw = Object.values(rows[0] ?? {})[0];
  const parsed = typeof raw === 'string' ? (JSON.parse(raw) as unknown) : raw;
  const root = (parsed as Record<string, unknown>[])[0];
  if (root === undefined) throw new Error('the explain produced no plan');
  return (root['Plan'] ?? {}) as PlanNode;
}

function entitlementScan(plan: PlanNode): PlanNode {
  const scan = planNodes(plan).find((node) => node['Relation Name'] === 'package_entitlements');
  if (scan === undefined) throw new Error('the plan never reads package_entitlements');
  return scan;
}

/** يقيس خطة الاستعلام نفسه اللي بيقراه القارئ، بمقياس PostgreSQL الافتراضي من غير أي تلاعب. */
async function explainSaleRead(
  companyId: string,
  after: string | null,
  limit: number,
): Promise<PlanNode> {
  return db.withTenant(companyId, async (tx) => {
    const statement = packageSaleCoverageStatement(companyId, after, limit);
    const result = await tx.execute(sql`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${statement}`);
    return rootPlan(result);
  });
}

const readSales = (companyId: string, after: string | null, limit: number) =>
  db.withTenant(companyId, (tx) => listCurrentPackageSales(tx, companyId, after, limit));

/** صفحات شركة تانية مباعة: بتكبّر الجدول زي الإنتاج وبتدي إحصاء provenance واقعي. */
const otherSoldSuffixes = Array.from({ length: OTHER_SOLD_ROWS }, (_, index) => 2 * index + 1);

it('an import-only company returns nothing and reads its own rows through the primary key', async () => {
  await seedImportedRows(A, '0192a000-0000-7000-8000-', IMPORTED_ROWS);
  await seedImportedRows(B, '0192b000-0000-7000-8000-', IMPORTED_ROWS);
  await seedSoldRows(B, '0192b000-0000-7000-8000-', otherSoldSuffixes);
  await owner`ANALYZE package_entitlements`;

  expect(await readSales(A.company, null, 200)).toEqual({ rows: [], nextAfter: null });

  const plan = await explainSaleRead(A.company, null, 200);
  const scan = entitlementScan(plan);
  const nodes = planNodes(plan);
  expect(nodes.some((node) => node['Node Type'] === 'Seq Scan')).toBe(false);
  expect(
    nodes.some(
      (node) =>
        node['Index Name'] === 'package_entitlements_pkey' &&
        INDEX_SCAN_TYPES.includes(String(node['Node Type'])),
    ),
  ).toBe(true);
  expect(scan['Actual Rows']).toBe(0);
  // المسح مقصور على صفحات المستأجر نفسه: صفحات شركة تانية ما اتقرتش خالص.
  expect(scan['Rows Removed by Filter']).toBe(1500);
  expect(
    Number(scan['Shared Hit Blocks'] ?? 0) + Number(scan['Shared Read Blocks'] ?? 0),
  ).toBeGreaterThan(0);
});

it('an import-heavy company pages its sales by the keyset and never leaves its own tenant', async () => {
  await seedImportedRows(A, '0192a000-0000-7000-8000-', IMPORTED_ROWS);
  await seedImportedRows(B, '0192b000-0000-7000-8000-', IMPORTED_ROWS);
  await seedSoldRows(B, '0192b000-0000-7000-8000-', otherSoldSuffixes);
  await seedSoldRows(A, '0192a000-0000-7000-8000-', SOLD_SUFFIXES);
  await owner`ANALYZE package_entitlements`;

  const first = await readSales(A.company, null, 5);
  const second = await readSales(A.company, first.nextAfter, 5);
  const third = await readSales(A.company, second.nextAfter, 5);
  const sold = (suffixes: readonly number[]) =>
    suffixes.map((suffix) => entitlementId('0192a000-0000-7000-8000-', suffix));

  expect(first.rows.map((row) => row.saleId)).toEqual(sold([1, 3, 5, 7, 499]));
  expect(second.rows.map((row) => row.saleId)).toEqual(sold([501, 503, 505, 2995, 2997]));
  expect(third.rows.map((row) => row.saleId)).toEqual(sold([2999, 3001]));
  expect(third.nextAfter).toBeNull();

  const scans = [];
  for (const after of [null, first.nextAfter, second.nextAfter]) {
    const pagePlan = await explainSaleRead(A.company, after, 5);
    scans.push(entitlementScan(pagePlan));
  }
  const actualRows = scans.reduce((sum, scan) => sum + Number(scan['Actual Rows'] ?? 0), 0);
  const filteredRows = scans.reduce(
    (sum, scan) => sum + Number(scan['Rows Removed by Filter'] ?? 0),
    0,
  );
  expect(actualRows).toBe(12);
  // كل صف استيراد اتفحص مرة واحدة بس: المفتاح بيتقدم للصفحة اللي بعدها.
  expect(filteredRows).toBe(1500);
  expect(actualRows + filteredRows).toBeLessThanOrEqual(1512);
});
