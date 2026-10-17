import { sql } from 'drizzle-orm';
import type postgres from 'postgres';
import type { Database } from '../src/index.ts';
import type { Tx } from '../src/with-tenant.ts';
import { ORDER_IDS } from './orders-fixture.ts';
import { TENANT, USER } from './tenancy-fixtures.ts';

export type Person = {
  employeeId: string;
  ordinal: number;
  share: number;
  userId: string | null;
  nameEn: string;
  nameAr: string | null;
  snapshotted: boolean;
  clock: boolean;
  leave: boolean;
};

export const performer = (employeeId: string, patch: Partial<Person> = {}): Person => ({
  employeeId,
  ordinal: 1,
  share: 10000,
  userId: null,
  nameEn: 'Synthetic',
  nameAr: null,
  snapshotted: true,
  clock: false,
  leave: false,
  ...patch,
});

export type ChangeCtx = {
  company: string;
  business: string;
  branch: string;
  userId: string;
  membershipId: string;
  sessionId: string;
  serviceId: string;
};

export const tenantA = (): ChangeCtx => ({
  company: TENANT.A.company,
  business: TENANT.A.business,
  branch: TENANT.A.branch,
  userId: USER,
  membershipId: ORDER_IDS.membership,
  sessionId: ORDER_IDS.session,
  serviceId: ORDER_IDS.service,
});

export const PERFORMER_STAFF = {
  emp2: '01920000-0000-7000-8000-000000004410',
  emp3: '01920000-0000-7000-8000-000000004411',
  otherBusiness: '01920000-0000-7000-8000-000000004412',
  otherBranch: '01920000-0000-7000-8000-000000004413',
  otherEmployee: '01920000-0000-7000-8000-000000004414',
  stranger: '01920000-0000-7000-8000-000000004415',
} as const;

type Ids = { newId(): string };

export async function seedPerformerChangeStaff(owner: postgres.Sql, ctx: ChangeCtx) {
  const staff = PERFORMER_STAFF;
  await owner`INSERT INTO "user"(id,name,email,email_verified,created_at,updated_at)
    VALUES(${staff.stranger},'Synthetic stranger','performer-change-stranger@example.test',true,now(),now())`;
  await owner`INSERT INTO employees(company_id,id,business_id,primary_branch_id,name_en,name_en_key,role_code,hire_date)
    VALUES(${ctx.company},${staff.emp2},${ctx.business},${ctx.branch},'Synthetic second','synthetic second performer','staff','2026-01-01'),
      (${ctx.company},${staff.emp3},${ctx.business},${ctx.branch},'Synthetic third','synthetic third performer','staff','2026-01-01')`;
  await owner`INSERT INTO businesses(company_id,id,name_en,vertical_type)
    VALUES(${ctx.company},${staff.otherBusiness},'Synthetic other salon','salon')`;
  await owner`INSERT INTO branches(company_id,id,business_id,name_en)
    VALUES(${ctx.company},${staff.otherBranch},${staff.otherBusiness},'Synthetic other branch')`;
  await owner`INSERT INTO employees(company_id,id,business_id,primary_branch_id,name_en,name_en_key,role_code,hire_date)
    VALUES(${ctx.company},${staff.otherEmployee},${staff.otherBusiness},${staff.otherBranch},'Synthetic other','synthetic other performer','staff','2026-01-01')`;
}

const lineSql = (ctx: ChangeCtx, lineId: string, ordinal: number, warning: boolean) =>
  sql`INSERT INTO service_lines(company_id,id,business_id,session_id,service_id,ordinal,input_index,status,revision,list_price,price,discount,net,
    effective_discount_bps,limit_source,limit_bps_applied,name_en,catalog_revision,rule_kind,counts_toward_threshold,has_performer_warning,
    recorded_by,recorded_by_membership_id,recorded_at,late)
    VALUES(${ctx.company},${lineId},${ctx.business},${ctx.sessionId},${ctx.serviceId},${ordinal},${ordinal - 1},'ACTIVE',1,1.000,1.000,0.000,1.000,
      0,'OWNER',NULL,'Synthetic',1,'ZERO',true,${warning},${ctx.userId},${ctx.membershipId},now(),false)`;

export const liveSql = (ctx: ChangeCtx, id: string, lineId: string, person: Person) =>
  sql`INSERT INTO line_performers(company_id,id,business_id,line_id,employee_id,performer_ordinal,share_bps,name_en,name_ar,
    not_clocked_in_warning,approved_leave_warning,linked_user_id,linked_user_snapshotted)
    VALUES(${ctx.company},${id},${ctx.business},${lineId},${person.employeeId},${person.ordinal},${person.share},${person.nameEn},${person.nameAr},
      ${person.clock},${person.leave},${person.userId},${person.snapshotted})`;

export async function recordLine(
  db: Database,
  ctx: ChangeCtx,
  ids: Ids,
  lineId: string,
  ordinal: number,
  people: readonly Person[],
) {
  const warning = people.some((person) => person.clock || person.leave);
  await db.withTenant(
    ctx.company,
    async (tx) => {
      await tx.execute(lineSql(ctx, lineId, ordinal, warning));
      for (const person of people) await tx.execute(liveSql(ctx, ids.newId(), lineId, person));
    },
    { userId: ctx.userId },
  );
}

export type Plan = {
  lineId: string;
  previous?: number;
  revision?: number;
  before: readonly Person[];
  after: readonly Person[];
  live: readonly Person[];
  warning?: boolean;
  reason?: string;
  writeXid?: string;
  changeId?: string;
  changerNameEn?: string | null;
  changerNameAr?: string | null;
  changerRole?: string | null;
  roleIsSystem?: boolean | null;
  roleNameEn?: string | null;
  roleNameAr?: string | null;
  skipHeader?: boolean;
  skipBefore?: boolean;
  skipCas?: boolean;
  skipDelete?: boolean;
  skipInsert?: boolean;
  skipAfter?: boolean;
  extraHeader?: boolean;
  immediate?: 'header' | 'before' | 'done';
  savepoint?: boolean;
  afterHeader?: () => Promise<void>;
  cas?: { lineId?: string; revision?: number; warning?: boolean; touchPrice?: boolean };
};

const defined = <T>(value: T | undefined, fallback: T): T =>
  value === undefined ? fallback : value;

export const headerSql = (ctx: ChangeCtx, plan: Plan, changeId: string) =>
  sql`INSERT INTO service_line_performer_changes(company_id,id,business_id,line_id,revision,previous_revision,reason,changed_at,
    changed_by,changed_by_membership_id,changer_name_ar,changer_name_en,changer_role,changer_role_is_system,changer_role_name_ar,changer_role_name_en,write_xid)
    VALUES(${ctx.company},${changeId},${ctx.business},${plan.lineId},${plan.revision ?? 2},${plan.previous ?? 1},${plan.reason ?? 'Changed performers'},
      clock_timestamp(),${ctx.userId},${ctx.membershipId},${defined(plan.changerNameAr, null)},${defined(plan.changerNameEn, 'Changer')},
      ${defined(plan.changerRole, null)},${defined(plan.roleIsSystem, null)},${defined(plan.roleNameAr, null)},${defined(plan.roleNameEn, null)},
      ${plan.writeXid ?? '1'}::xid8)`;

export const sideSql = (
  ctx: ChangeCtx,
  id: string,
  changeId: string,
  side: string,
  person: Person,
) =>
  sql`INSERT INTO service_line_performer_change_rows(company_id,id,business_id,change_id,side,employee_id,performer_ordinal,share_bps,
    name_en,name_ar,linked_user_id,linked_user_snapshotted,not_clocked_in_warning,approved_leave_warning)
    VALUES(${ctx.company},${id},${ctx.business},${changeId},${side},${person.employeeId},${person.ordinal},${person.share},
      ${person.nameEn},${person.nameAr},${person.userId},${person.snapshotted},${person.clock},${person.leave})`;

async function insertSides(
  tx: Tx,
  ctx: ChangeCtx,
  ids: Ids,
  changeId: string,
  side: 'BEFORE' | 'AFTER',
  people: readonly Person[],
) {
  for (const person of people) await tx.execute(sideSql(ctx, ids.newId(), changeId, side, person));
}

const casSql = (ctx: ChangeCtx, plan: Plan) => {
  const price = plan.cas?.touchPrice === true ? sql`, price = price + 1` : sql``;
  return sql`UPDATE service_lines SET revision=${plan.cas?.revision ?? plan.revision ?? 2}, has_performer_warning=${plan.cas?.warning ?? plan.warning ?? false}${price}
    WHERE company_id=${ctx.company} AND id=${plan.cas?.lineId ?? plan.lineId}`;
};

export async function applyChange(tx: Tx, ctx: ChangeCtx, ids: Ids, plan: Plan) {
  const changeId = plan.changeId ?? ids.newId();
  if (plan.savepoint) {
    await tx.execute(sql`SAVEPOINT performer_change`);
    await tx.execute(headerSql(ctx, plan, changeId));
    await tx.execute(sql`ROLLBACK TO SAVEPOINT performer_change`);
    await tx.execute(
      sql`DELETE FROM line_performers WHERE company_id=${ctx.company} AND line_id=${plan.lineId}`,
    );
    return changeId;
  }
  if (plan.skipHeader !== true) await tx.execute(headerSql(ctx, plan, changeId));
  if (plan.afterHeader !== undefined) await plan.afterHeader();
  if (plan.extraHeader === true) await tx.execute(headerSql(ctx, plan, ids.newId()));
  if (plan.immediate === 'header') {
    await tx.execute(sql`SET CONSTRAINTS ALL IMMEDIATE`);
    return changeId;
  }
  if (plan.skipBefore !== true) await insertSides(tx, ctx, ids, changeId, 'BEFORE', plan.before);
  if (plan.immediate === 'before') {
    await tx.execute(sql`SET CONSTRAINTS ALL IMMEDIATE`);
    return changeId;
  }
  if (plan.skipCas !== true) await tx.execute(casSql(ctx, plan));
  if (plan.skipDelete !== true) {
    await tx.execute(
      sql`DELETE FROM line_performers WHERE company_id=${ctx.company} AND line_id=${plan.lineId}`,
    );
  }
  if (plan.skipInsert !== true) {
    for (const person of plan.live)
      await tx.execute(liveSql(ctx, ids.newId(), plan.lineId, person));
  }
  if (plan.skipAfter !== true) await insertSides(tx, ctx, ids, changeId, 'AFTER', plan.after);
  if (plan.immediate === 'done') await tx.execute(sql`SET CONSTRAINTS ALL IMMEDIATE`);
  return changeId;
}

export const commitChange = (db: Database, ctx: ChangeCtx, ids: Ids, plan: Plan) =>
  db.withTenant(ctx.company, (tx) => applyChange(tx, ctx, ids, plan), { userId: ctx.userId });
