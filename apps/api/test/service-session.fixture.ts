import { createDatabase, SYSTEM_ROLES, type TenantWrappers, type Tx } from '@pospay/db';
import { employeeNameMatchKey } from '@pospay/domain';
import { systemUuidV7 } from '@pospay/ids';
import type { SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { startHarness } from './harness.ts';
import { ordersLineEdits, ordersTransactions } from '../src/modules/orders/orders.module.ts';
import { createSessionRecovery } from '../src/modules/orders/persistence/session-recovery.adapter.ts';
import { RecordServiceSessionUseCase } from '../src/modules/orders/use-cases/record-service-session/record-service-session.usecase.ts';
import { AppendServiceSessionLinesUseCase } from '../src/modules/orders/use-cases/append-service-session-lines/append-service-session-lines.usecase.ts';
import { EditServiceLinePriceUseCase } from '../src/modules/orders/use-cases/edit-service-line-price/edit-service-line-price.usecase.ts';

export const ids = systemUuidV7();
export const AT = new Date('2026-10-15T08:00:00.000Z');
export function must<T>(value: T | null | undefined): T {
  if (value === undefined || value === null) throw new Error('Required fixture value missing');
  return value;
}
export async function sessionFixture(options: Parameters<typeof startHarness>[0] = {}) {
  const h = await startHarness(options);
  const ownerCookie = await h.signedInOperator('session-owner@example.test');
  const cookie = await h.signedInOperator('session-cashier@example.test');
  const company = await h.onboard(ownerCookie, 'Synthetic session employer');
  const otherCompany = await h.onboard(cookie, 'Synthetic other employer');
  const users = await h.owner`SELECT id,email FROM "user" WHERE email IN ('session-owner@example.test','session-cashier@example.test')`;
  const userId = must(users.find((u) => u['email'] === 'session-cashier@example.test'))['id'] as string;
  const ownerId = must(users.find((u) => u['email'] === 'session-owner@example.test'))['id'] as string;
  const business = ids.newId(), branch = ids.newId(), secondBusiness = ids.newId(), secondBranch = ids.newId();
  const foreignBusiness = ids.newId(), foreignBranch = ids.newId();
  for (const [co, bu, br] of [[company, business, branch], [company, secondBusiness, secondBranch], [otherCompany, foreignBusiness, foreignBranch]]) {
    await h.owner`INSERT INTO businesses(company_id,id,name_en,vertical_type,timezone) VALUES(${must(co)},${must(bu)},'Synthetic salon','salon','Asia/Kuwait')`;
    await h.owner`INSERT INTO branches(company_id,id,business_id,name_en) VALUES(${must(co)},${must(br)},${must(bu)},'Synthetic branch')`;
  }
  const membership = ids.newId();
  const cashier = must(SYSTEM_ROLES.find((r) => r.code === 'cashier')).id;
  await h.owner`INSERT INTO memberships(company_id,id,user_id,role_id,role_owner_key,scope_type,scope_id,limit_bps)
    VALUES(${company},${membership},${userId},${cashier},'global','BRANCH',${branch},1000)`;
  // ساعة الاختبارات ثابتة على أكتوبر 2026 (AT وأوقات الإجازات)، والعضويات بتبدأ بالوقت الحقيقي؛ لو الوقت الحقيقي عدّى
  // الساعة الثابتة، العضوية تبان لسه ما بدأتش والإذن يرجع 403. فبتبدأ قبل أي لحظة في الاختبارات.
  await h.owner`UPDATE memberships SET starts_at='2026-01-01T00:00:00Z' WHERE company_id IN (${company}, ${otherCompany})`;
  const customer = ids.newId();
  await h.owner`INSERT INTO customers(company_id,id,name,phone,locale,created_at,updated_at) VALUES(${company},${customer},'Synthetic customer','+999999998123','en',now(),now())`;
  const services: string[] = [];
  for (const [i, [price, kind, pct, fixed]] of [['25.000','FOLLOW_PLAN',null,null], ['7.125','PCT',1000,null], ['0.000','ZERO',null,null], ['15.000','FIXED',null,'2.500']].entries()) {
    const id = ids.newId(); services.push(id);
    await h.owner`INSERT INTO services(company_id,id,business_id,name_en,price,commission_rule_kind,commission_pct_bps,commission_fixed_amount)
      VALUES(${company},${id},${business},${`Synthetic service ${i}`},${price as string},${kind as string},${pct as number | null},${fixed as string | null})`;
  }
  const employees: string[] = [];
  for (let i = 0; i < 4; i++) {
    const id = ids.newId(); employees.push(id);
    await h.owner`INSERT INTO employees(company_id,id,business_id,primary_branch_id,name_en,name_en_key,role_code,hire_date)
      VALUES(${company},${id},${business},${branch},${`Synthetic employee ${i}`},${`synthetic employee ${i}`},'staff','2026-01-01')`;
    await h.owner`INSERT INTO employee_branches(company_id,id,business_id,employee_id,branch_id,"from") VALUES(${company},${ids.newId()},${business},${id},${branch},'2026-01-01')`;
  }
  const editor = await sessionEditor(h, company, business, branch, ownerId);
  const db = createDatabase({ url: h.urls.app, ids });
  let at = AT;
  const clock = { now: () => at };
  const transactions = ordersTransactions(db, ids, clock);
  const recovery = createSessionRecovery(db, ids, clock);
  const create = new RecordServiceSessionUseCase(transactions, recovery, ids, clock);
  const append = new AppendServiceSessionLinesUseCase(transactions, recovery, ids, clock);
  const edit = new EditServiceLinePriceUseCase(ordersLineEdits(db), ids, clock);
  const context = (key = ids.newId(), actor = userId, fingerprint = 'a'.repeat(64)) => ({ companyId: company, userId: actor, businessId: business, branchId: branch, key, fingerprint });
  const line = (service = must(services[0]), price = '25.000', discount = '0.000') => ({ service_id: service, price,
    discount: { kind: 'AMOUNT' as const, amount: discount }, performers: [{ employee_id: must(employees[0]) }] });
  const body = (lines = [line()]) => ({ customer_id: customer, occurred_at: '2026-10-14T08:00:00.000Z', lines });
  const base = `/v1/businesses/${business}/branches/${branch}/service-sessions`;
  return { h, db, company, otherCompany, userId, ownerId, ownerCookie, cookie, membership, business, branch, secondBusiness, secondBranch,
    foreignBusiness, foreignBranch, customer, services, employees, clock, create, append, edit, transactions, context, line, body, base, ...editor,
    linkEmployee: (employeeId: string, linkedUser: string | null) => h.owner`UPDATE employees SET user_id=${linkedUser} WHERE company_id=${company} AND id=${employeeId}`,
    snapshotPerformers: (lineId: string, rows: PerformerSnapshot[]) => applyPerformerSnapshot(h, company, lineId, rows),
    setAt: (next: Date) => { at = next; }, close: async () => { await db.close(); await h.close(); } };
}
interface PerformerSnapshot { employee_id: string; linked_user_id: string | null; linked_user_snapshotted: boolean }
async function sessionEditor(h: Awaited<ReturnType<typeof startHarness>>, company: string, business: string, branch: string, ownerId: string) {
  await h.signedInOperator('session-editor@example.test');
  const users = await h.owner`SELECT id FROM "user" WHERE email='session-editor@example.test'`;
  const editorId = must(users[0])['id'] as string;
  const editorMembership = ids.newId();
  const role = must(SYSTEM_ROLES.find((item) => item.code === 'branch_manager')).id;
  const nameEn = 'Layla Editor';
  const nameAr = 'ليلى';
  const editorEmployee = ids.newId();
  await h.owner`INSERT INTO memberships(company_id,id,user_id,role_id,role_owner_key,scope_type,scope_id,limit_bps,starts_at)
    VALUES(${company},${editorMembership},${editorId},${role},'global','BRANCH',${branch},2000,'2026-01-01T00:00:00Z')`;
  await h.owner`INSERT INTO employees(company_id,id,business_id,primary_branch_id,user_id,name_en,name_en_key,name_ar,name_ar_key,role_code,hire_date)
    VALUES(${company},${editorEmployee},${business},${branch},${editorId},${nameEn},${employeeNameMatchKey(nameEn)},${nameAr},${employeeNameMatchKey(nameAr)},'branch_manager','2026-01-01')`;
  await h.owner`INSERT INTO employee_branches(company_id,id,business_id,employee_id,branch_id,"from") VALUES(${company},${ids.newId()},${business},${editorEmployee},${branch},'2026-01-01')`;
  const owners = await h.owner`SELECT id FROM memberships WHERE company_id=${company} AND user_id=${ownerId} AND scope_type='COMPANY' ORDER BY id`;
  return { editorId, editorMembership, editorEmployee, ownerMembership: must(owners[0])['id'] as string };
}
async function applyPerformerSnapshot(h: Awaited<ReturnType<typeof startHarness>>, company: string, lineId: string, rows: readonly PerformerSnapshot[]) {
  for (const row of rows) {
    await h.owner`UPDATE line_performers SET linked_user_id=${row.linked_user_id}, linked_user_snapshotted=${row.linked_user_snapshotted}
      WHERE company_id=${company} AND line_id=${lineId} AND employee_id=${row.employee_id}`;
  }
}
export type SessionFixture = Awaited<ReturnType<typeof sessionFixture>>;
export function interceptDatabase(database: TenantWrappers, inspect: (statement: string) => Promise<void>): TenantWrappers {
  const dialect = new PgDialect();
  return { ...database, withTenant: (company, work, options) => database.withTenant(company, (tx) => work(new Proxy(tx, {
    get: (target, property, receiver) => property === 'execute' ? async (query: SQL) => {
      await inspect(dialect.sqlToQuery(query).sql); return target.execute(query);
    } : Reflect.get(target, property, receiver),
  }) as Tx), options) };
}
