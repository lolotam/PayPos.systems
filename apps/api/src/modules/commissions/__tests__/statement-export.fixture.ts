import { documentBytesKey, documentStatusKey } from '@pospay/contracts';
import { createDatabase, type Database } from '@pospay/db';

import {
  insertCommissionLine,
  walkCommissionStatement,
} from '../../../../../../packages/db/test/commission-statement-fixtures.ts';
import {
  customRoleMember,
  estimateFixture,
  ids,
  PERMISSION,
  permissionOverride,
  type EstimateFixture,
} from './commission-estimate.fixture.ts';

export const EXPORT_PERIOD = '2026-10';
/** شهر مدفوع بكشف من غير صفوف موظفات، عشان إثبات إن PAID بيتصدّر زي APPROVED. */
export const PAID_PERIOD = '2026-08';

export type ExportFixture = EstimateFixture & {
  readonly db: Database;
  readonly statementId: string;
  /** مستخدم مدير الفرع الأول وعضويته، عشان الاختبار ينقله أو يلغي صلاحيته. */
  readonly branchManagerUser: string;
  readonly branchManagerMembership: string;
};

/**
 * يبني كشف أكتوبر معتمد بصفّي موظفتين مجمّدين: الأولى مربوطة بالفرع الأول والتانية بالفرع التاني،
 * عشان نطاق قارئ الفرع يتميّز عن نطاق قارئ النشاط (CM-23d…CM-23h).
 */
export async function exportFixture(): Promise<ExportFixture> {
  const base = await estimateFixture();
  const db = createDatabase({ url: base.h.urls.app, ids });
  const [membership] = await base.h.owner`SELECT id, user_id FROM memberships
    WHERE company_id=${base.company} AND scope_type='COMPANY' LIMIT 1`;
  const author = { id: membership?.['user_id'] as string };
  const tenant = { ...base.tenant, membership: membership?.['id'] as string };
  const statementId = await walkCommissionStatement(db, {
    tenant,
    reviewer: author?.['id'] as string,
    period: EXPORT_PERIOD,
    ids,
    to: 'APPROVED',
    afterApproved: async (tx, id) => {
      await insertCommissionLine(tx, tenant, id, ids, {
        kind: 'EMPLOYEE',
        employeeNumber: 1,
        attachedBranchIds: [base.branch],
      });
      await insertCommissionLine(tx, { ...tenant, employee: base.secondEmployee }, id, ids, {
        kind: 'EMPLOYEE',
        employeeNumber: 2,
        attachedBranchIds: [base.secondBranch],
      });
    },
  });
  await walkCommissionStatement(db, {
    tenant,
    reviewer: author?.['id'] as string,
    period: PAID_PERIOD,
    ids,
    to: 'PAID',
  });
  const [manager] = await base.h.owner`SELECT m.id, m.user_id FROM memberships m
    WHERE m.company_id=${base.company} AND m.scope_type='BRANCH' AND m.scope_id=${base.branch}`;
  return {
    ...base,
    db,
    statementId,
    branchManagerUser: manager?.['user_id'] as string,
    branchManagerMembership: manager?.['id'] as string,
  };
}

/** صف طلب التصدير بمعرّف مستنده. */
export async function exportRow(f: ExportFixture, renderId: string) {
  const [row] = await f.h.owner`SELECT scope, branch_ids, employee_ids, language, requested_by,
    requested_membership_id, collected_at, statement_id, period FROM commission_statement_exports
    WHERE company_id=${f.company} AND render_id=${renderId}`;
  return row;
}

export function exportPath(f: ExportFixture, suffix = '', period = EXPORT_PERIOD): string {
  return `/v1/businesses/${f.business}/commission-statements/${period}/exports${suffix}`;
}

export function requestExport(
  f: ExportFixture,
  cookie: string,
  body: object = { language: 'ar' },
  period = EXPORT_PERIOD,
) {
  return f.h.send('POST', exportPath(f, '', period), { cookie, company: f.company, body });
}

/** حالة المستند وبايتاته في Redis، زي ما العامل بيسيبهم بعد ما يجهّز الملف. */
export async function seedReadyDocument(
  f: ExportFixture,
  renderId: string,
  requestedBy: string,
): Promise<void> {
  await f.h.redis.hset(documentStatusKey(f.company, renderId), {
    state: 'READY',
    requested_by: requestedBy,
    filename: 'commission-statement-2026-10.xlsx',
    mime_type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  await f.h.redis.set(documentBytesKey(f.company, renderId), 'synthetic-xlsx-bytes');
}

export function collectExport(f: ExportFixture, cookie: string, renderId: string) {
  return f.h.app.inject({
    method: 'POST',
    url: exportPath(f, `/${renderId}/download`),
    headers: { cookie, 'x-company-id': f.company },
  });
}

export async function exportAudits(f: ExportFixture, renderId: string) {
  return f.h.owner`SELECT actor_user_id, action, "after" FROM audit_log
    WHERE company_id=${f.company} AND entity='commission_statement'
      AND action='commission_statement.exported' AND "after"->>'render_id'=${renderId}`;
}

export const bytesPresent = async (f: ExportFixture, renderId: string) =>
  (await f.h.redis.exists(documentBytesKey(f.company, renderId))) === 1;

/** عضوية فرع تانية لنفس المستخدم بنفس الدور، عشان نطاقه يبقى اتحاد الفرعين (CM-23d). */
export async function addBranchMembership(
  f: ExportFixture,
  userId: string,
  branch: string,
): Promise<string> {
  const [source] = await f.h
    .owner`SELECT role_id FROM memberships WHERE id=${f.branchManagerMembership}`;
  const id = ids.newId();
  await f.h
    .owner`INSERT INTO memberships(company_id,id,user_id,role_id,role_owner_key,scope_type,scope_id)
    VALUES (${f.company},${id},${userId},${source?.['role_id']},${f.company},'BRANCH',${branch})`;
  return id;
}

/** مدير على مستوى النشاط بمنح شخصي على القراءة، وممكن يتضاف له DENY على فرع (CM-23e). */
export async function businessReader(f: ExportFixture, code: string) {
  const member = await customRoleMember(f, code, 'BUSINESS');
  await permissionOverride(f, member.membershipId, 'ALLOW', { type: 'BUSINESS', id: f.business });
  return member;
}

export { PERMISSION };
