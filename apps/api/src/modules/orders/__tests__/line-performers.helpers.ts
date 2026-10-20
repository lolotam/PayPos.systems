import type { ChangeLinePerformersInput } from '@pospay/contracts';
import { SYSTEM_ROLES } from '@pospay/db';
import { employeeNameMatchKey } from '@pospay/domain';
import { expect } from 'vitest';
import { takeTestEmployeeNumber } from '../../../../test/test-employee-number.ts';
import { ordersLineCancels, ordersLinePerformers, ordersSessionTips } from '../orders.module.ts';
import { CancelServiceLineUseCase } from '../use-cases/cancel-service-line/cancel-service-line.usecase.ts';
import { ChangeLinePerformersUseCase } from '../use-cases/change-line-performers/change-line-performers.usecase.ts';
import { RecordSessionTipsUseCase } from '../use-cases/record-session-tips/record-session-tips.usecase.ts';
import { ids, must, editFixture, type EditFixture } from './session.fixture.ts';

export const PERFORMERS_REASON = 'Synthetic performers reason';

type PerformersBundle = EditFixture & {
  change: ChangeLinePerformersUseCase;
  cancel: CancelServiceLineUseCase;
  tips: RecordSessionTipsUseCase;
};

type PerformersPatch = {
  performers?: { employee_id: string; share_bps?: number }[];
  reason?: string;
  expected_revision?: number;
  changer_membership_id?: string;
};

type ChangeOptions = {
  userId?: string;
  key?: string;
  fingerprint?: string;
  companyId?: string;
  businessId?: string;
  branchId?: string;
};

type ScopeCode = 'general_manager' | 'business_manager' | 'branch_manager' | 'device';

/** طبقة تغيير المنفّذين فوق editFixture؛ الممثّل الافتراضي هو مديرة الفرع مش الكاشير. */
export async function performersFixture(): Promise<PerformersBundle> {
  const base = await editFixture();
  return {
    ...base,
    change: new ChangeLinePerformersUseCase(ordersLinePerformers(base.db), ids, base.clock),
    cancel: new CancelServiceLineUseCase(ordersLineCancels(base.db), ids, base.clock),
    tips: new RecordSessionTipsUseCase(ordersSessionTips(base.db), ids, base.clock),
  };
}

export type PerformersFixture = PerformersBundle;

export function performersInput(patch: PerformersPatch = {}): ChangeLinePerformersInput {
  return {
    performers: patch.performers ?? [],
    reason: patch.reason ?? PERFORMERS_REASON,
    expected_revision: patch.expected_revision ?? 1,
    ...(patch.changer_membership_id === undefined ? {} : { changer_membership_id: patch.changer_membership_id }),
  };
}

export function runChange(
  f: PerformersFixture,
  sessionId: string,
  lineId: string,
  input: ChangeLinePerformersInput,
  options: ChangeOptions = {},
) {
  return f.change.execute({
    ...f.context(options.key ?? ids.newId(), options.userId ?? f.editorId, options.fingerprint),
    ...(options.companyId === undefined ? {} : { companyId: options.companyId }),
    ...(options.businessId === undefined ? {} : { businessId: options.businessId }),
    ...(options.branchId === undefined ? {} : { branchId: options.branchId }),
    sessionId,
    lineId,
    input,
  });
}

export async function visitOf(f: PerformersFixture, lines?: Parameters<PerformersFixture['body']>[0]) {
  const result = await f.create.execute({
    ...f.context(),
    input: f.body(lines ?? [f.line(must(f.services[0]), '25.000', '0.000')]),
  });
  return { sessionId: result.session.id, lines: result.session.lines, recordedBy: result.session.recorded_by };
}

export async function changeRows(f: PerformersFixture, sessionId: string, lineId: string) {
  const headers = await f.h.owner`SELECT revision,previous_revision,reason,changed_by,changed_by_membership_id,changed_at,
    changer_name_ar,changer_name_en,changer_role,changer_role_is_system,changer_role_name_ar,changer_role_name_en,
    write_xid,write_system_id
    FROM service_line_performer_changes WHERE company_id=${f.company} AND line_id=${lineId} ORDER BY revision`;
  const sides = await f.h.owner`SELECT c.revision AS change_revision,r.side,r.employee_id,r.performer_ordinal,r.share_bps,r.name_en,r.name_ar,
    r.linked_user_id,r.linked_user_snapshotted,r.not_clocked_in_warning,r.approved_leave_warning
    FROM service_line_performer_change_rows r
    JOIN service_line_performer_changes c ON c.company_id=r.company_id AND c.id=r.change_id
    WHERE r.company_id=${f.company} AND c.line_id=${lineId}
    ORDER BY c.revision, CASE r.side WHEN 'BEFORE' THEN 0 ELSE 1 END, r.performer_ordinal`;
  const live = await f.h.owner`SELECT employee_id,performer_ordinal,share_bps,name_en,name_ar,linked_user_id,
    linked_user_snapshotted,not_clocked_in_warning,approved_leave_warning
    FROM line_performers WHERE company_id=${f.company} AND line_id=${lineId} ORDER BY performer_ordinal`;
  const audits = await f.h.owner`SELECT after FROM audit_log
    WHERE company_id=${f.company} AND entity_id=${lineId} AND action='service_line.performers_changed'`;
  const events = await f.h.owner`SELECT payload FROM outbox
    WHERE company_id=${f.company} AND aggregate_id=${sessionId} AND event_type='ServiceLineChanged'
    ORDER BY seq`;
  const [line] = await f.h.owner`SELECT status,revision,price::text,discount::text,net::text,has_performer_warning
    FROM service_lines WHERE company_id=${f.company} AND id=${lineId}`;
  return { headers, sides, live, audits, events, line: must(line) };
}

export async function changeQuiet(f: PerformersFixture, sessionId: string, lineId: string, key: string) {
  const headers = await f.h.owner`SELECT 1 FROM service_line_performer_changes WHERE company_id=${f.company} AND line_id=${lineId}`;
  const audits = await f.h.owner`SELECT 1 FROM audit_log
    WHERE company_id=${f.company} AND entity_id=${lineId} AND action='service_line.performers_changed'`;
  const events = await f.h.owner`SELECT 1 FROM outbox
    WHERE company_id=${f.company} AND aggregate_id=${sessionId} AND event_type='ServiceLineChanged'`;
  const keys = await f.h.owner`SELECT 1 FROM idempotency_keys WHERE company_id=${f.company} AND key=${key}`;
  return { headers: headers.length, audits: audits.length, events: events.length, keys: keys.length };
}

/** يزرع موظفة جديدة باسم ورابط وعقد وارتباط فرع قابل للضبط، فحالات الأهلية تُبنى بلا لمس موظفات الفيكستشر. */
export async function createEmployee(
  f: PerformersFixture,
  options: { contract_end?: string | null; branch_from?: string; user_id?: string | null } = {},
) {
  const id = ids.newId();
  const number = takeTestEmployeeNumber(f.company);
  const nameEn = `Synthetic added employee ${id}`;
  await f.h.owner`INSERT INTO employees(company_id,id,business_id,primary_branch_id,user_id,name_en,name_en_key,role_code,hire_date,contract_end,employee_number)
    VALUES(${f.company},${id},${f.business},${f.branch},${options.user_id ?? null},
      ${nameEn},${employeeNameMatchKey(nameEn)},'staff','2026-01-01',${options.contract_end ?? null},${number})`;
  await f.h.owner`INSERT INTO employee_branches(company_id,id,business_id,employee_id,branch_id,"from")
    VALUES(${f.company},${ids.newId()},${f.business},${id},${f.branch},${options.branch_from ?? '2026-01-01'})`;
  return id;
}

/** يسجّل زيارة عند وقت تنفيذ محدّد، ففحص الأهلية يقع عند ذلك اليوم لا عند يوم اليوم. */
export async function visitAt(
  f: PerformersFixture,
  occurredAt: string,
  lines?: Parameters<PerformersFixture['body']>[0],
) {
  const result = await f.create.execute({
    ...f.context(),
    input: { ...f.body(lines ?? [f.line(must(f.services[0]), '25.000', '0.000')]), occurred_at: occurredAt },
  });
  return { sessionId: result.session.id, lines: result.session.lines };
}

export async function livePerformers(f: PerformersFixture, lineId: string) {
  return f.h.owner`SELECT employee_id,performer_ordinal,share_bps,name_en,name_ar,linked_user_id,
    linked_user_snapshotted,not_clocked_in_warning,approved_leave_warning
    FROM line_performers WHERE company_id=${f.company} AND line_id=${lineId} ORDER BY performer_ordinal`;
}

/** يزرع تنبيهات الحضور على صف حيّ، فالمنفّذة الباقية تحمل راياتها القديمة كما تنسخها القاعدة. */
export async function seedWarnings(
  f: PerformersFixture,
  lineId: string,
  rows: { employee_id: string; not_clocked_in_warning: boolean; approved_leave_warning: boolean }[],
) {
  for (const row of rows) {
    await f.h.owner`UPDATE line_performers SET not_clocked_in_warning=${row.not_clocked_in_warning},
      approved_leave_warning=${row.approved_leave_warning}
      WHERE company_id=${f.company} AND line_id=${lineId} AND employee_id=${row.employee_id}`;
  }
}

export async function sessionStamp(f: PerformersFixture, sessionId: string) {
  const [row] = await f.h.owner`SELECT xmin::text AS xmin FROM service_sessions WHERE company_id=${f.company} AND id=${sessionId}`;
  return row?.['xmin'];
}

export function payloadOf(value: unknown): unknown {
  return typeof value === 'string' ? (JSON.parse(value) as unknown) : value;
}

export function nineColumns(row: Record<string, unknown>) {
  return {
    employee_id: row['employee_id'],
    performer_ordinal: Number(row['performer_ordinal']),
    share_bps: Number(row['share_bps']),
    name_en: row['name_en'],
    name_ar: row['name_ar'],
    linked_user_id: row['linked_user_id'],
    linked_user_snapshotted: row['linked_user_snapshotted'],
    not_clocked_in_warning: row['not_clocked_in_warning'],
    approved_leave_warning: row['approved_leave_warning'],
  };
}

export async function expectHidden(
  f: PerformersFixture,
  sessionId: string,
  lineId: string,
  key: string,
  reason: string,
  result: unknown,
) {
  expect(JSON.stringify(result)).not.toContain(reason);
  const leaked = await f.h.owner`SELECT 1 FROM outbox WHERE company_id=${f.company} AND aggregate_id=${sessionId} AND payload::text LIKE ${'%' + reason + '%'}
    UNION ALL SELECT 1 FROM audit_log WHERE company_id=${f.company} AND entity_id=${lineId}
      AND (after::text LIKE ${'%' + reason + '%'} OR COALESCE(before::text,'') LIKE ${'%' + reason + '%'})
    UNION ALL SELECT 1 FROM idempotency_keys WHERE company_id=${f.company} AND key=${key} AND response_body::text LIKE ${'%' + reason + '%'}`;
  const [customer] = await f.h.owner`SELECT name,phone FROM customers WHERE company_id=${f.company} AND id=${f.customer}`;
  const rows = await changeRows(f, sessionId, lineId);
  const [stored] = await f.h.owner`SELECT response_body::text AS body FROM idempotency_keys WHERE company_id=${f.company} AND key=${key}`;
  const packed = JSON.stringify({ result, events: rows.events, audits: rows.audits, stored: stored?.['body'] });
  expect(packed).not.toContain(String(customer?.['name']));
  expect(packed).not.toContain(String(customer?.['phone']));
  return leaked.length;
}

export async function scopedMember(
  f: PerformersFixture,
  email: string,
  code: ScopeCode,
  scopeType: 'COMPANY' | 'BUSINESS' | 'BRANCH',
  scopeId: string,
) {
  await f.h.signedInOperator(email);
  const users = await f.h.owner`SELECT id FROM "user" WHERE email=${email}`;
  const userId = must(users[0])['id'] as string;
  const membershipId = ids.newId();
  const role = must(SYSTEM_ROLES.find((item) => item.code === code)).id;
  await f.h.owner`INSERT INTO memberships(company_id,id,user_id,role_id,role_owner_key,scope_type,scope_id,limit_bps,starts_at)
    VALUES(${f.company},${membershipId},${userId},${role},'global',${scopeType},${scopeId},NULL,'2026-01-01T00:00:00Z')`;
  return { userId, membershipId };
}

export async function performersOnlyRole(f: PerformersFixture, email: string) {
  await f.h.signedInOperator(email);
  const users = await f.h.owner`SELECT id FROM "user" WHERE email=${email}`;
  const userId = must(users[0])['id'] as string;
  const role = ids.newId();
  const membershipId = ids.newId();
  await f.h.owner`INSERT INTO roles(id,company_id,code,name_en) VALUES(${role},${f.company},'synthetic_line_performers','Synthetic performer changer')`;
  await f.h.owner`INSERT INTO role_permissions(role_id,role_owner_key,company_id,permission_code)
    VALUES(${role},${f.company},${f.company},'change:service-line-performers:branch')`;
  await f.h.owner`INSERT INTO memberships(company_id,id,user_id,role_id,role_owner_key,scope_type,scope_id,limit_bps,starts_at)
    VALUES(${f.company},${membershipId},${userId},${role},${f.company},'BRANCH',${f.branch},10000,'2026-01-01T00:00:00Z')`;
  return { userId, membershipId };
}
