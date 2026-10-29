import { createDatabase } from '@pospay/db';
import { systemUuidV7 } from '@pospay/ids';

import { startHarness } from '../../../../test/harness.ts';
import { listServiceCategories } from '../queries/service-categories.query.ts';
import { createServiceCategoryTransactions } from '../persistence/drizzle-service-category-transactions.ts';
import { CreateServiceCategoryUseCase } from '../use-cases/create-service-category/create-service-category.usecase.ts';
import { RenameServiceCategoryUseCase } from '../use-cases/rename-service-category/rename-service-category.usecase.ts';

const ids = systemUuidV7();
const AT = new Date('2026-10-29T10:00:00Z');

export async function serviceCategoriesFixture() {
  const h = await startHarness();
  const ownerCookie = await h.signedInOperator('category-owner@example.test');
  const cookie = await h.signedInOperator('category-manager@example.test');
  const company = await h.onboard(ownerCookie, 'Synthetic category employer');
  const otherCompany = await h.onboard(cookie, 'Synthetic category other employer');
  const [holder] = await h.owner`SELECT id FROM "user" WHERE email='category-manager@example.test'`;
  const userId = holder?.['id'] as string;
  const memberId = ids.newId();
  const role = ids.newId();
  await h.owner`INSERT INTO roles(id,company_id,code,name_en)
    VALUES (${role},${company},'synthetic_category_editor','Synthetic category editor')`;
  await h.owner`INSERT INTO memberships(company_id,id,user_id,role_id,role_owner_key,scope_type,scope_id)
    VALUES (${company},${memberId},${userId},${role},${company},'COMPANY',${company})`;
  const business = ids.newId();
  const secondBusiness = ids.newId();
  const foreignBusiness = ids.newId();
  for (const [co, bu] of [
    [company, business],
    [company, secondBusiness],
    [otherCompany, foreignBusiness],
  ]) {
    await h.owner`INSERT INTO businesses (company_id,id,name_en,vertical_type)
      VALUES (${co as string},${bu as string},'Synthetic business','salon')`;
  }
  const branch = ids.newId();
  const otherBranch = ids.newId();
  await h.owner`INSERT INTO branches(company_id,id,business_id,name_en)
    VALUES (${company},${branch},${business},'Synthetic category branch'),
           (${company},${otherBranch},${business},'Synthetic category other branch')`;
  const db = createDatabase({ url: h.urls.app, ids });
  const transactions = createServiceCategoryTransactions(db, ids);
  const clock = { now: () => AT };
  return {
    h,
    cookie,
    company,
    otherCompany,
    userId,
    memberId,
    role,
    business,
    secondBusiness,
    foreignBusiness,
    branch,
    otherBranch,
    db,
    transactions,
    create: new CreateServiceCategoryUseCase(transactions, ids, clock),
    rename: new RenameServiceCategoryUseCase(transactions, clock),
  };
}

export type ServiceCategoryFixture = Awaited<ReturnType<typeof serviceCategoriesFixture>>;

export const namesFor = (name = 'Synthetic category') => ({
  name_en: name,
  name_ar: 'تصنيف تجريبي',
});

export async function grantCategories(
  f: ServiceCategoryFixture,
  business = f.business,
  permission:
    | 'read:service-categories:business'
    | 'manage:service-categories:business' = 'manage:service-categories:business',
) {
  await f.h
    .owner`INSERT INTO permission_overrides (company_id,id,membership_id,permission_code,effect,scope_type,scope_id,reason,granted_by)
    VALUES (${f.company},${ids.newId()},${f.memberId},${permission},'ALLOW','BUSINESS',${business},'Synthetic grant',${f.userId})`;
}

export async function grantBranchCategories(f: ServiceCategoryFixture, branchId: string) {
  await f.h
    .owner`INSERT INTO permission_overrides (company_id,id,membership_id,permission_code,effect,scope_type,scope_id,reason,granted_by)
    VALUES (${f.company},${ids.newId()},${f.memberId},'manage:service-categories:branch','ALLOW','BRANCH',${branchId},'Synthetic grant',${f.userId})`;
}

/** صلاحية فرع واحدة: تُمنح على فرع بعينه، فلا تفتح مسار فرع آخر ولا مسار النشاط. */
export type BranchCategoryPermission =
  | 'read:service-categories:branch'
  | 'manage:service-categories:branch';

/**
 * عضو جديد بصلاحية فرع فقط: عضوية بدور بلا صلاحيات، ومنح فرع واحد بالاستثناء.
 * العضوية القائمة في الاختبار لديها صلاحية النشاط، فالعضو الجديد لازم يكون مستقل عنها.
 */
export async function branchOnlyMember(
  f: ServiceCategoryFixture,
  branchId: string,
  permissions: readonly BranchCategoryPermission[] = ['manage:service-categories:branch'],
) {
  const email = `category-branch-only-${ids.newId()}@example.test`;
  const cookie = await f.h.signedInOperator(email);
  const [holder] = await f.h.owner`SELECT id FROM "user" WHERE email=${email}`;
  const userId = holder?.['id'] as string;
  const memberId = ids.newId();
  await f.h
    .owner`INSERT INTO memberships(company_id,id,user_id,role_id,role_owner_key,scope_type,scope_id)
    VALUES (${f.company},${memberId},${userId},${f.role},${f.company},'COMPANY',${f.company})`;
  for (const permission of permissions) {
    await f.h
      .owner`INSERT INTO permission_overrides (company_id,id,membership_id,permission_code,effect,scope_type,scope_id,reason,granted_by)
      VALUES (${f.company},${ids.newId()},${memberId},${permission},'ALLOW','BRANCH',${branchId},'Synthetic grant',${f.userId})`;
  }
  return { cookie, userId, memberId };
}

/** يحمل التصنيفات عبر مسار القراءة كما تفعل الشاشة، لفحص العزل والنطاق. */
export function listFor(
  f: ServiceCategoryFixture,
  companyId: string,
  businessId: string,
  query: Parameters<typeof listServiceCategories>[3],
) {
  return f.db.withTenant(companyId, (tx) => listServiceCategories(tx, companyId, businessId, query));
}
