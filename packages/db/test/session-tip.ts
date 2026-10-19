import { sql } from 'drizzle-orm';
import type postgres from 'postgres';
import type { Database } from '../src/index.ts';
import { ORDER_IDS } from './orders-fixture.ts';
import { TENANT, USER } from './tenancy-fixtures.ts';

export const TIP = {
  foreignSession: '01920000-0000-7000-8000-000000004601',
  foreignEmployee: '01920000-0000-7000-8000-000000004602',
  otherSession: '01920000-0000-7000-8000-000000004603',
  otherBusiness: '01920000-0000-7000-8000-000000004604',
  otherBranch: '01920000-0000-7000-8000-000000004605',
  otherEmployee: '01920000-0000-7000-8000-000000004606',
} as const;

export type TipCtx = {
  company: string;
  business: string;
  branch: string;
  userId: string;
  membershipId: string;
  sessionId: string;
  employeeId: string;
};

export type RevisionRow = {
  id: string;
  sessionId: string;
  businessId?: string;
  revision: number;
  previous: number | null;
  reason: string | null;
  eventId: string;
  writeXid?: string;
};

export type TipRow = {
  id: string;
  revisionId: string;
  sessionId: string;
  businessId?: string;
  employeeId?: string;
  method?: string;
  amount?: string;
};

type Ids = { newId(): string };

export const tenantA = (): TipCtx => ({
  company: TENANT.A.company,
  business: TENANT.A.business,
  branch: TENANT.A.branch,
  userId: USER,
  membershipId: ORDER_IDS.membership,
  sessionId: ORDER_IDS.session,
  employeeId: ORDER_IDS.employee,
});

export const tenantB = (): TipCtx => ({
  company: TENANT.B.company,
  business: TENANT.B.business,
  branch: TENANT.B.branch,
  userId: USER,
  membershipId: ORDER_IDS.membership,
  sessionId: ORDER_IDS.session,
  employeeId: ORDER_IDS.employee,
});

export async function openSession(owner: postgres.Sql, ctx: TipCtx, sessionId: string) {
  await owner`INSERT INTO service_sessions(company_id,id,business_id,branch_id,customer_id,customer_name,customer_phone_masked,
    recorded_by,recorded_by_membership_id,occurred_at,recorded_at,business_date,business_timezone,late)
    VALUES(${ctx.company},${sessionId},${ctx.business},${ctx.branch},${ORDER_IDS.customer},'Synthetic customer','***123',
      ${ctx.userId},${ctx.membershipId},now(),now(),current_date,'Asia/Kuwait',false)`;
}

export async function seedSessionTipStaff(owner: postgres.Sql) {
  const a = tenantA();
  const b = tenantB();
  await openSession(owner, b, TIP.foreignSession);
  await owner`INSERT INTO employees(company_id,id,business_id,primary_branch_id,name_en,name_en_key,role_code,hire_date,employee_number)
    VALUES(${b.company},${TIP.foreignEmployee},${b.business},${b.branch},'Synthetic foreign','synthetic foreign tip','staff','2026-01-01',2)`;
  await owner`INSERT INTO businesses(company_id,id,name_en,vertical_type)
    VALUES(${a.company},${TIP.otherBusiness},'Synthetic other tip salon','salon')`;
  await owner`INSERT INTO branches(company_id,id,business_id,name_en)
    VALUES(${a.company},${TIP.otherBranch},${TIP.otherBusiness},'Synthetic other tip branch')`;
  await owner`INSERT INTO employees(company_id,id,business_id,primary_branch_id,name_en,name_en_key,role_code,hire_date,employee_number)
    VALUES(${a.company},${TIP.otherEmployee},${TIP.otherBusiness},${TIP.otherBranch},'Synthetic other tip','synthetic other tip','staff','2026-01-01',2)`;
  await openSession(owner, a, TIP.otherSession);
}

const defaultReason = (revisionNo: number): string | null =>
  revisionNo === 1 ? null : 'Replaced the tip';

export function revisionRow(
  ids: Ids,
  sessionId: string,
  revisionNo: number,
  patch: Partial<RevisionRow> = {},
): RevisionRow {
  const row: RevisionRow = {
    id: patch.id ?? ids.newId(),
    sessionId: patch.sessionId ?? sessionId,
    revision: revisionNo,
    previous:
      patch.previous === undefined ? (revisionNo === 1 ? null : revisionNo - 1) : patch.previous,
    reason: patch.reason === undefined ? defaultReason(revisionNo) : patch.reason,
    eventId: patch.eventId ?? ids.newId(),
  };
  if (patch.businessId !== undefined) row.businessId = patch.businessId;
  if (patch.writeXid !== undefined) row.writeXid = patch.writeXid;
  return row;
}

export function tipRow(
  ids: Ids,
  revisionId: string,
  sessionId: string,
  patch: Partial<TipRow> = {},
): TipRow {
  const row: TipRow = {
    id: patch.id ?? ids.newId(),
    revisionId,
    sessionId: patch.sessionId ?? sessionId,
  };
  if (patch.businessId !== undefined) row.businessId = patch.businessId;
  if (patch.employeeId !== undefined) row.employeeId = patch.employeeId;
  if (patch.method !== undefined) row.method = patch.method;
  if (patch.amount !== undefined) row.amount = patch.amount;
  return row;
}

export const revisionSql = (ctx: TipCtx, row: RevisionRow) =>
  sql`INSERT INTO session_tip_revisions(company_id,id,business_id,session_id,revision,previous_revision,
    changed_by,changed_by_membership_id,changed_at,reason,event_id,write_xid)
    VALUES(${ctx.company},${row.id},${row.businessId ?? ctx.business},${row.sessionId},${row.revision},${row.previous},
      ${ctx.userId},${ctx.membershipId},clock_timestamp(),${row.reason},${row.eventId},${row.writeXid ?? '1'}::xid8)`;

const amountSql = (amount: string | undefined) =>
  amount === 'NaN' ? sql`'NaN'::numeric` : sql`${amount ?? '1.000'}::numeric`;

export const tipSql = (ctx: TipCtx, row: TipRow) =>
  sql`INSERT INTO session_tips(company_id,id,business_id,revision_id,session_id,employee_id,method,amount)
    VALUES(${ctx.company},${row.id},${row.businessId ?? ctx.business},${row.revisionId},${row.sessionId},
      ${row.employeeId ?? ctx.employeeId},${row.method ?? 'CARD'},${amountSql(row.amount)})`;

export async function writeRevision(
  db: Database,
  ctx: TipCtx,
  row: RevisionRow,
  tips: readonly TipRow[] = [],
) {
  await db.withTenant(
    ctx.company,
    async (tx) => {
      await tx.execute(revisionSql(ctx, row));
      for (const entry of tips) await tx.execute(tipSql(ctx, entry));
    },
    { userId: ctx.userId },
  );
}
