import { sql, type SQL } from 'drizzle-orm';
import { ids, must, sessionFixture, type SessionFixture } from './session.fixture.ts';
import { packageLine } from './package-redemption.fixture.ts';

export interface CustomerPackagesFixtureResult {
  f: SessionFixture;
  packages: {
    a: string;
    b: string;
    c: string;
    d: string;
    e: string;
    f: string;
  };
  otherCustomer: string;
  packageType: string;
}

/**
 * ينشئ بيئة اختبار قراءة باقات العميلة مع باقات بحالات ورتب مختلفة.
 */
export async function customerPackagesFixture(): Promise<CustomerPackagesFixtureResult> {
  const f = await sessionFixture();
  return seedCustomerPackages(f).catch(async (error) => {
    throw await f.close().then(
      () => error,
      (cleanup) => new AggregateError([error, cleanup]),
    );
  });
}

type PackageKey = keyof CustomerPackagesFixtureResult['packages'];
type PackageIds = Record<PackageKey, string>;

interface SeedIds {
  packageType: string;
  otherCustomer: string;
  importPreview: string;
  ent: PackageIds;
  comp: PackageIds;
}

interface SoldRow {
  id: string;
  customer: string;
  name: string;
  nameAr: string;
  price: string;
  soldOn: string;
  expiresOn: string;
}

function newPackageIds(): PackageIds {
  return {
    a: ids.newId(),
    b: ids.newId(),
    c: ids.newId(),
    d: ids.newId(),
    e: ids.newId(),
    f: ids.newId(),
  };
}

async function seedCustomerPackages(f: SessionFixture): Promise<CustomerPackagesFixtureResult> {
  const seed: SeedIds = {
    packageType: ids.newId(),
    otherCustomer: ids.newId(),
    importPreview: ids.newId(),
    ent: newPackageIds(),
    comp: newPackageIds(),
  };
  await seedReferenceRows(f, seed);
  await seedEntitlementRows(f, seed);

  // استهلاك حقيقي عبر فحص الاستقبال: جلسة من (a) وكل جلسات (d)، فتتحول USED نظامياً مش بإدخال يدوي
  for (const entitlement of [seed.ent.a, seed.ent.d, seed.ent.d]) {
    await f.create.execute({
      ...f.context(ids.newId()),
      input: f.body([packageLine(f, entitlement)]),
    });
  }

  await f.h.owner.unsafe('ANALYZE package_entitlements, package_components, package_session_slots');
  return {
    f,
    packages: seed.ent,
    otherCustomer: seed.otherCustomer,
    packageType: seed.packageType,
  };
}

async function seedReferenceRows(f: SessionFixture, seed: SeedIds): Promise<void> {
  const importFile = ids.newId();
  await f.db.withTenant(f.company, async (tx) => {
    await tx.execute(
      sql`INSERT INTO package_types(company_id,id,business_id,name_en,price,validity_days)
        VALUES(${f.company},${seed.packageType},${f.business},'Synthetic package type','50.000',90)`,
    );
    await tx.execute(
      sql`INSERT INTO customers(company_id,id,name,phone,locale,created_at,updated_at)
        VALUES(${f.company},${seed.otherCustomer},'Other customer','+999999998124','en',now(),now())`,
    );
  });

  // ملف ومعاينة الاستيراد لربط باقة الاستيراد المستوفية للتريغر
  await f.h
    .owner`INSERT INTO file_objects(company_id,id,business_id,owner_module,owner_entity_id,staging_key,
    content_type,size_bytes,required_permission,created_by,created_at)
    VALUES(${f.company},${importFile},${f.business},'import',${importFile},'synthetic-pkg-import','application/pdf',10,
    'read:files:business',${f.userId},now())`;
  await f.h
    .owner`INSERT INTO import_previews(company_id,id,business_id,entity,file_id,created_by,created_at,
    expires_at,row_count,error_count,rows,errors)
    VALUES(${f.company},${seed.importPreview},${f.business},'packages',${importFile},${f.userId},now(),now() + interval '1 day',1,0,
    '[]'::jsonb,'[]'::jsonb)`;
}

function soldEntitlement(f: SessionFixture, packageType: string, row: SoldRow): SQL {
  const soldAt = `${row.soldOn}T08:00:00Z`;
  return sql`INSERT INTO package_entitlements
    (company_id,id,business_id,customer_id,package_type_id,provenance,name_en,name_ar,validity_days,list_price,price_paid,
      discount,discount_bps,paid_method,seller_employee_id,seller_linked_user_id,sold_branch_id,sold_at,sold_business_date,
      sold_timezone,recorded_by,recorded_by_membership_id,expires_on)
    VALUES(${f.company},${row.id},${f.business},${row.customer},${packageType},'SOLD',${row.name},${row.nameAr},
      90,${row.price},${row.price},'0.000',0,'CASH',${must(f.employees[0])},${f.userId},${f.branch},
      ${soldAt}::timestamptz,${row.soldOn}::date,'Asia/Kuwait',${f.userId},${f.membership},${row.expiresOn}::date)`;
}

// price_paid = مجموع قيم المكوّنات (ختم package_entitlement_value_conservation)
function soldRows(f: SessionFixture, seed: SeedIds): SoldRow[] {
  // [المفتاح، الاسم، الاسم العربي، السعر، تاريخ البيع، تاريخ الانتهاء]
  const rows: [PackageKey, string, string, string, string, string][] = [
    // (a) صالحة وتنتهي متأخراً — تباع قبل 14 أكتوبر لاستهلاك جلسة منها
    ['a', 'Package A', 'باقة أ', '32.500', '2026-10-10', '2026-11-10'],
    // (b) صالحة وتنتهي مبكراً
    ['b', 'Package B', 'باقة ب', '20.000', '2026-10-10', '2026-10-25'],
    // (c) منتهية الصلاحية لكن بها جلسات متاحة
    ['c', 'Package C', 'باقة ج', '10.000', '2026-09-01', '2026-10-01'],
    // (d) مستهلكة بالكامل — تباع قبل 14 أكتوبر لاستهلاك كامل جلساتها
    ['d', 'Package D', 'باقة د', '20.000', '2026-10-10', '2026-11-01'],
    // (f) باقة لعميلة أخرى بنفس النشاط
    ['f', 'Package F', 'باقة و', '10.000', '2026-10-10', '2026-11-15'],
  ];
  return rows.map(([key, name, nameAr, price, soldOn, expiresOn]) => ({
    id: seed.ent[key],
    customer: key === 'f' ? seed.otherCustomer : f.customer,
    name,
    nameAr,
    price,
    soldOn,
    expiresOn,
  }));
}

function slotValues(f: SessionFixture, seed: SeedIds): SQL[] {
  // جلسات الباقات المباعة كلها بتبدأ FREE وفق قيود التخزين؛ المستوردة (e) بس أول جلستين فيها IMPORTED_USED
  const values: Record<PackageKey, string[]> = {
    a: ['10.000', '10.000', '12.500'],
    b: ['10.000', '10.000'],
    c: ['10.000'],
    d: ['10.000', '10.000'],
    e: ['10.000', '10.000', '10.000'],
    f: ['10.000'],
  };
  return (Object.keys(values) as PackageKey[]).flatMap((key) =>
    values[key].map((value, index) => {
      const state = key === 'e' && index < 2 ? 'IMPORTED_USED' : 'FREE';
      return sql`(${f.company},${ids.newId()},${f.business},${seed.ent[key]},${seed.comp[key]},${index + 1},${value},${state})`;
    }),
  );
}

async function seedEntitlementRows(f: SessionFixture, seed: SeedIds): Promise<void> {
  const { ent, comp } = seed;
  await f.db.withTenant(f.company, async (tx) => {
    for (const row of soldRows(f, seed))
      await tx.execute(soldEntitlement(f, seed.packageType, row));

    // (e) مستوردة IMPORTED بها جلسات IMPORTED_USED وجلسات FREE
    await tx.execute(sql`INSERT INTO package_entitlements
      (company_id,id,business_id,customer_id,provenance,name_en,price_paid,recorded_by,recorded_by_membership_id,
        external_ref,import_batch_id,import_row,expires_on)
      VALUES(${f.company},${ent.e},${f.business},${f.customer},'IMPORTED','Package E','30.000',
        ${f.userId},${f.membership},'EXT-IMP-E',${seed.importPreview},1,'2026-11-25'::date)`);

    await tx.execute(sql`INSERT INTO package_components
      (company_id,id,business_id,entitlement_id,service_id,position,name_en,name_ar,list_price_snapshot,sessions_total,component_value)
      VALUES(${f.company},${comp.a},${f.business},${ent.a},${must(f.services[0])},1,'Multi-price component','مكون متعدد الأسعار',
        '15.000',3,'32.500'),
        (${f.company},${comp.b},${f.business},${ent.b},${must(f.services[1])},1,'Service B',NULL,'10.000',2,'20.000'),
        (${f.company},${comp.c},${f.business},${ent.c},${must(f.services[0])},1,'Service C',NULL,'10.000',1,'10.000'),
        (${f.company},${comp.d},${f.business},${ent.d},${must(f.services[0])},1,'Service D',NULL,'10.000',2,'20.000'),
        (${f.company},${comp.e},${f.business},${ent.e},${must(f.services[2])},1,'Service E',NULL,'0.000',3,'30.000'),
        (${f.company},${comp.f},${f.business},${ent.f},${must(f.services[0])},1,'Service F',NULL,'10.000',1,'10.000')`);

    await tx.execute(sql`INSERT INTO package_session_slots
      (company_id,id,business_id,entitlement_id,component_id,ordinal,unit_value,state)
      VALUES ${sql.join(slotValues(f, seed), sql`,`)}`);
  });
}

/**
 * يزرع 60 استحقاقاً للعميلة و5 لكل واحدة من 40 عميلة تانية، مع 3 مكوّنات و30 جلسة لكل استحقاق، لاختبار EXPLAIN.
 * العميلات التانيين عشان شرط customer_id يبقى انتقائي زي الإنتاج، وإلا المخطِّط يعتبر أي فهرس على company_id زيه.
 * كل مكوّن على خدمة مختلفة لأن (entitlement_id, service_id) فريد في package_components.
 */
export async function seedLargePackageSet(f: SessionFixture, packageType: string): Promise<void> {
  const [s1, s2, s3] = [must(f.services[0]), must(f.services[1]), must(f.services[2])];
  const employee = must(f.employees[0]);
  await f.db.withTenant(f.company, async (tx) => {
    await tx.execute(sql`
      INSERT INTO customers(company_id, id, name, phone, locale, created_at, updated_at)
      SELECT ${f.company}, gen_random_uuid(), 'Bulk customer ' || i, '+9999997' || lpad(i::text, 5, '0'),
        'en', now(), now()
      FROM generate_series(1, 40) AS i
    `);
    await tx.execute(sql`
      WITH owners AS (
        SELECT ${f.customer}::uuid AS customer_id, i FROM generate_series(1, 60) AS i
        UNION ALL
        SELECT c.id, i FROM customers c CROSS JOIN generate_series(1, 5) AS i
        WHERE c.company_id = ${f.company} AND c.name LIKE 'Bulk customer %'
      ),
      ins_e AS (
        INSERT INTO package_entitlements (
          company_id, id, business_id, customer_id, package_type_id, provenance, name_en,
          validity_days, list_price, price_paid, discount, discount_bps, paid_method,
          seller_employee_id, sold_branch_id, sold_at, sold_business_date, sold_timezone,
          recorded_by, recorded_by_membership_id, expires_on
        )
        SELECT
          ${f.company}, gen_random_uuid(), ${f.business}, owners.customer_id, ${packageType}, 'SOLD',
          'Bulk package ' || i, 90, '900.000', '900.000', '0.000', 0, 'CASH',
          ${employee}, ${f.branch}, '2026-10-15T08:00:00Z'::timestamptz, '2026-10-15'::date, 'Asia/Kuwait',
          ${f.userId}, ${f.membership}, ('2026-12-01'::date + (i || ' days')::interval)::date
        FROM owners
        RETURNING id
      )
      INSERT INTO package_components (
        company_id, id, business_id, entitlement_id, service_id, position, name_en,
        list_price_snapshot, sessions_total, component_value
      )
      SELECT
        ${f.company}, gen_random_uuid(), ${f.business}, ins_e.id, svc.service_id, svc.pos,
        'Bulk component ' || svc.pos, '10.000', 30, '300.000'
      FROM ins_e
      CROSS JOIN (VALUES (1, ${s1}::uuid), (2, ${s2}::uuid), (3, ${s3}::uuid)) AS svc(pos, service_id)
    `);
    // الجلسات في جملة منفصلة: تريجر package_components_closed_composition بيشتغل آخر الجملة،
    // فلو الجلسات دخلت في نفس الجملة هيلاقيها ويرفض المكوّنات
    await tx.execute(sql`
      INSERT INTO package_session_slots (
        company_id, id, business_id, entitlement_id, component_id, ordinal, unit_value, state
      )
      SELECT c.company_id, gen_random_uuid(), c.business_id, c.entitlement_id, c.id, ord, '10.000', 'FREE'
      FROM package_components c
      CROSS JOIN generate_series(1, 30) AS ord
      WHERE c.company_id = ${f.company} AND c.name_en LIKE 'Bulk component %'
    `);
  });
  await f.h.owner.unsafe('ANALYZE package_entitlements, package_components, package_session_slots');
}

/**
 * ينشئ بيئة مستقلة محملة بمجموعة الـ 60 باقة لاختبار خطة الـ EXPLAIN دون التأثير على بيانات الاختبارات الوظيفية.
 */
export async function customerPackagesExplainFixture(): Promise<{
  f: SessionFixture;
  packageType: string;
}> {
  const f = await sessionFixture();
  const packageType = ids.newId();
  return f.db
    .withTenant(f.company, (tx) =>
      tx.execute(
        sql`INSERT INTO package_types(company_id,id,business_id,name_en,price,validity_days)
          VALUES(${f.company},${packageType},${f.business},'Synthetic explain package type','300.000',90)`,
      ),
    )
    .then(async () => {
      await seedLargePackageSet(f, packageType);
      return { f, packageType };
    })
    .catch(async (error) => {
      throw await f.close().then(
        () => error,
        (cleanup) => new AggregateError([error, cleanup]),
      );
    });
}
