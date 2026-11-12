import { sql } from 'drizzle-orm';
import type { Tx } from '@pospay/db';
import { ids, must, sessionFixture, type SessionFixture } from './session.fixture.ts';

interface SimplePackageParams {
  companyId: string;
  businessId: string;
  branchId: string;
  customerId: string;
  packageTypeId: string;
  entitlementId: string;
  componentId: string;
  serviceId: string;
  name: string;
  expiresOn: string;
  employeeId: string;
  userId: string;
  membershipId: string;
}

/**
 * يزرع باقة مباعة أحادية المكوّن وجلسة واحدة مستوفية لكل قيود ختم التخزين.
 */
async function insertSoldPackage(tx: Tx, p: SimplePackageParams): Promise<void> {
  await tx.execute(sql`INSERT INTO package_entitlements
    (company_id,id,business_id,customer_id,package_type_id,provenance,name_en,validity_days,
      list_price,price_paid,discount,discount_bps,paid_method,seller_employee_id,sold_branch_id,
      sold_at,sold_business_date,sold_timezone,recorded_by,recorded_by_membership_id,expires_on)
    VALUES(${p.companyId},${p.entitlementId},${p.businessId},${p.customerId},${p.packageTypeId},'SOLD',
      ${p.name},90,'10.000','10.000','0.000',0,'CASH',${p.employeeId},${p.branchId},
      '2026-10-10T08:00:00Z'::timestamptz,'2026-10-10'::date,'Asia/Kuwait',${p.userId},${p.membershipId},${p.expiresOn}::date)`);

  await tx.execute(sql`INSERT INTO package_components
    (company_id,id,business_id,entitlement_id,service_id,position,name_en,list_price_snapshot,sessions_total,component_value)
    VALUES(${p.companyId},${p.componentId},${p.businessId},${p.entitlementId},${p.serviceId},1,
      'Service', '10.000', 1, '10.000')`);

  await tx.execute(sql`INSERT INTO package_session_slots
    (company_id,id,business_id,entitlement_id,component_id,ordinal,unit_value,state)
    VALUES(${p.companyId},gen_random_uuid(),${p.businessId},${p.entitlementId},${p.componentId},1,'10.000','FREE')`);
}

export interface TimeScenarioFixtureResult {
  f: SessionFixture;
  pacificBranch: string;
  packageT1: string;
  packagesD: { d1: string; d2: string; d3: string };
}

/**
 * يزرع بيئة اختبارات الوقت: فرع بتوقيت كيريباتي (+14) مختلف عن النشاط (+3) وباقات للتدرج الزمني والترتيب.
 */
export async function timeScenarioFixture(): Promise<TimeScenarioFixtureResult> {
  const f = await sessionFixture();
  try {
    const pacificBranch = ids.newId();
    await f.h.owner`INSERT INTO branches(company_id,id,business_id,name_en,timezone)
      VALUES(${f.company},${pacificBranch},${f.business},'Pacific Branch','Pacific/Kiritimati')`;

    const pkgType = ids.newId();
    await f.h.owner`INSERT INTO package_types(company_id,id,business_id,name_en,price,validity_days)
      VALUES(${f.company},${pkgType},${f.business},'Time package type','10.000',90)`;

    const entT1 = ids.newId();
    const entD1 = ids.newId();
    const entD2 = ids.newId();
    const entD3 = ids.newId();

    const employee = must(f.employees[0]);
    const service = must(f.services[0]);

    await f.db.withTenant(f.company, async (tx) => {
      // باقة الفرع ذي التوقيت الخاص (تنتهي 2026-11-10)
      await insertSoldPackage(tx, {
        companyId: f.company, businessId: f.business, branchId: pacificBranch,
        customerId: f.customer, packageTypeId: pkgType, entitlementId: entT1,
        componentId: ids.newId(), serviceId: service, name: 'Pkg T1', expiresOn: '2026-11-10',
        employeeId: employee, userId: f.userId, membershipId: f.membership,
      });

      // 3 باقات لاختبار تغير الرتبة أثناء التصفح D5
      await insertSoldPackage(tx, {
        companyId: f.company, businessId: f.business, branchId: f.branch,
        customerId: f.customer, packageTypeId: pkgType, entitlementId: entD1,
        componentId: ids.newId(), serviceId: service, name: 'Pkg D1', expiresOn: '2026-11-05',
        employeeId: employee, userId: f.userId, membershipId: f.membership,
      });
      await insertSoldPackage(tx, {
        companyId: f.company, businessId: f.business, branchId: f.branch,
        customerId: f.customer, packageTypeId: pkgType, entitlementId: entD2,
        componentId: ids.newId(), serviceId: service, name: 'Pkg D2', expiresOn: '2026-11-15',
        employeeId: employee, userId: f.userId, membershipId: f.membership,
      });
      await insertSoldPackage(tx, {
        companyId: f.company, businessId: f.business, branchId: f.branch,
        customerId: f.customer, packageTypeId: pkgType, entitlementId: entD3,
        componentId: ids.newId(), serviceId: service, name: 'Pkg D3', expiresOn: '2026-11-20',
        employeeId: employee, userId: f.userId, membershipId: f.membership,
      });
    });

    return {
      f,
      pacificBranch,
      packageT1: entT1,
      packagesD: { d1: entD1, d2: entD2, d3: entD3 },
    };
  } catch (error) {
    await f.close().catch(() => undefined);
    throw error;
  }
}

export interface IsolationScenarioFixtureResult {
  f: SessionFixture;
  pkgBusiness1: string;
  pkgBusiness2: string;
  foreignCustomer: string;
  pkgOtherCompany: string;
}

/**
 * يزرع باقة الشركة الأجنبية بكل معرفاتها من الشركة الأجنبية نفسها دون اعتماد على معرفات شركتنا.
 */
async function seedForeignCompanyPackage(
  f: SessionFixture,
  foreignCustomer: string,
  foreignPkgType: string,
  entForeign: string,
): Promise<void> {
  const foreignService = ids.newId();
  const foreignEmployeeId = ids.newId();

  await f.h.owner`INSERT INTO services(company_id,id,business_id,name_en,price,commission_rule_kind)
    VALUES(${f.otherCompany},${foreignService},${f.foreignBusiness},'Foreign Service','10.000','ZERO')`;

  await f.h.owner`INSERT INTO employees(company_id,id,business_id,primary_branch_id,name_en,name_en_key,role_code,hire_date,employee_number)
    VALUES(${f.otherCompany},${foreignEmployeeId},${f.foreignBusiness},${f.foreignBranch},'Foreign Staff','foreign staff','staff','2026-01-01',201)`;

  const foreignUsers = await f.h.owner`SELECT id FROM "user" WHERE email='session-cashier@example.test'`;
  const foreignUserId = must(foreignUsers[0])['id'] as string;
  const foreignMemberships = await f.h.owner`SELECT id FROM memberships WHERE company_id=${f.otherCompany} AND user_id=${foreignUserId}`;
  const foreignMembershipId = must(foreignMemberships[0])['id'] as string;

  await f.db.withTenant(f.otherCompany, async (tx) => {
    await insertSoldPackage(tx, {
      companyId: f.otherCompany, businessId: f.foreignBusiness, branchId: f.foreignBranch,
      customerId: foreignCustomer, packageTypeId: foreignPkgType, entitlementId: entForeign,
      componentId: ids.newId(), serviceId: foreignService, name: 'Foreign Pkg', expiresOn: '2026-12-31',
      employeeId: foreignEmployeeId, userId: foreignUserId, membershipId: foreignMembershipId,
    });
  });
}

/**
 * يزرع باقات النشاطين التابعين لنفس الشركة مع موظف مستقل لكل نشاط لتفادي خطأ المفتاح الأجنبي.
 */
async function seedOwnBusinessesPackages(
  f: SessionFixture,
  pkgType1: string,
  pkgType2: string,
  ent1: string,
  ent2: string,
  service2: string,
): Promise<void> {
  const secondBusinessEmployeeId = ids.newId();
  await f.h.owner`INSERT INTO employees(company_id,id,business_id,primary_branch_id,name_en,name_en_key,role_code,hire_date,employee_number)
    VALUES(${f.company},${secondBusinessEmployeeId},${f.secondBusiness},${f.secondBranch},'Staff Bus 2','staff bus 2','staff','2026-01-01',301)`;

  const employee = must(f.employees[0]);
  const service1 = must(f.services[0]);

  await f.db.withTenant(f.company, async (tx) => {
    await insertSoldPackage(tx, {
      companyId: f.company, businessId: f.business, branchId: f.branch,
      customerId: f.customer, packageTypeId: pkgType1, entitlementId: ent1,
      componentId: ids.newId(), serviceId: service1, name: 'Pkg Bus 1', expiresOn: '2026-12-31',
      employeeId: employee, userId: f.userId, membershipId: f.membership,
    });

    // باقة ثانية في النشاط الأول عشان صفحة بحد 1 تطلّع مؤشر نقدر نعيد استخدامه في نشاط تاني
    await insertSoldPackage(tx, {
      companyId: f.company, businessId: f.business, branchId: f.branch,
      customerId: f.customer, packageTypeId: pkgType1, entitlementId: ids.newId(),
      componentId: ids.newId(), serviceId: service1, name: 'Pkg Bus 1b', expiresOn: '2027-01-15',
      employeeId: employee, userId: f.userId, membershipId: f.membership,
    });

    await insertSoldPackage(tx, {
      companyId: f.company, businessId: f.secondBusiness, branchId: f.secondBranch,
      customerId: f.customer, packageTypeId: pkgType2, entitlementId: ent2,
      componentId: ids.newId(), serviceId: service2, name: 'Pkg Bus 2', expiresOn: '2026-12-31',
      employeeId: secondBusinessEmployeeId, userId: f.userId, membershipId: f.membership,
    });
  });
}

/**
 * يزرع بيئة اختبارات العزل: باقات لنفس العميلة بين نشاطين، وباقة في شركة أخرى لعميلة أجنبية.
 */
export async function isolationScenarioFixture(): Promise<IsolationScenarioFixtureResult> {
  const f = await sessionFixture();
  try {
    const pkgType1 = ids.newId();
    const pkgType2 = ids.newId();
    const foreignPkgType = ids.newId();

    const service2 = ids.newId();
    const foreignCustomer = ids.newId();

    await f.h.owner`INSERT INTO services(company_id,id,business_id,name_en,price,commission_rule_kind)
      VALUES(${f.company},${service2},${f.secondBusiness},'Service Bus 2','10.000','ZERO')`;

    await f.h.owner`INSERT INTO customers(company_id,id,name,phone,locale,created_at,updated_at)
      VALUES(${f.otherCompany},${foreignCustomer},'Foreign Customer','+999999998888','en',now(),now())`;

    await f.h.owner`INSERT INTO package_types(company_id,id,business_id,name_en,price,validity_days)
      VALUES(${f.company},${pkgType1},${f.business},'Type 1','10.000',90),
            (${f.company},${pkgType2},${f.secondBusiness},'Type 2','10.000',90),
            (${f.otherCompany},${foreignPkgType},${f.foreignBusiness},'Type Other','10.000',90)`;

    const ent1 = ids.newId();
    const ent2 = ids.newId();
    const entForeign = ids.newId();

    await seedOwnBusinessesPackages(f, pkgType1, pkgType2, ent1, ent2, service2);
    await seedForeignCompanyPackage(f, foreignCustomer, foreignPkgType, entForeign);

    return {
      f,
      pkgBusiness1: ent1,
      pkgBusiness2: ent2,
      foreignCustomer,
      pkgOtherCompany: entForeign,
    };
  } catch (error) {
    await f.close().catch(() => undefined);
    throw error;
  }
}
