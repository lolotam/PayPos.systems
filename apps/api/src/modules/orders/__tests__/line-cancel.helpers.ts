import type { CancelServiceLineInput } from '@pospay/contracts';
import { SYSTEM_ROLES } from '@pospay/db';
import { expect } from 'vitest';
import { ordersLineCancels, ordersSessionTips } from '../orders.module.ts';
import { CancelServiceLineUseCase } from '../use-cases/cancel-service-line/cancel-service-line.usecase.ts';
import { RecordSessionTipsUseCase } from '../use-cases/record-session-tips/record-session-tips.usecase.ts';
import { ids, must, editFixture, type EditFixture } from './session.fixture.ts';

export const CANCEL_REASON = 'Synthetic cancel reason';

type CancelBundle = EditFixture & {
  cancel: CancelServiceLineUseCase;
  tips: RecordSessionTipsUseCase;
};

/** طبقة الإلغاء فوق editFixture من غير ما تغيّره؛ الممثّل الافتراضي هو مديرة الفرع مش الكاشير. */
export async function cancelFixture(): Promise<CancelBundle> {
  const base = await editFixture();
  return {
    ...base,
    cancel: new CancelServiceLineUseCase(ordersLineCancels(base.db), ids, base.clock),
    tips: new RecordSessionTipsUseCase(ordersSessionTips(base.db), ids, base.clock),
  };
}

export type CancelFixture = CancelBundle;

type CancelPatch = { reason?: string; expected_revision?: number; canceller_membership_id?: string };
type CancelOptions = {
  userId?: string;
  key?: string;
  fingerprint?: string;
  companyId?: string;
  businessId?: string;
  branchId?: string;
};
type ScopeCode = 'general_manager' | 'business_manager' | 'device';

export function cancelInput(patch: CancelPatch = {}): CancelServiceLineInput {
  return {
    reason: patch.reason ?? CANCEL_REASON,
    expected_revision: patch.expected_revision ?? 1,
    ...(patch.canceller_membership_id === undefined ? {} : { canceller_membership_id: patch.canceller_membership_id }),
  };
}

export function runCancel(
  f: CancelFixture,
  sessionId: string,
  lineId: string,
  input: CancelServiceLineInput = cancelInput(),
  options: CancelOptions = {},
) {
  return f.cancel.execute({
    ...f.context(options.key ?? ids.newId(), options.userId ?? f.editorId, options.fingerprint),
    ...(options.companyId === undefined ? {} : { companyId: options.companyId }),
    ...(options.businessId === undefined ? {} : { businessId: options.businessId }),
    ...(options.branchId === undefined ? {} : { branchId: options.branchId }),
    sessionId,
    lineId,
    input,
  });
}

export async function visitOf(f: CancelFixture, lines?: Parameters<CancelFixture['body']>[0]) {
  const result = await f.create.execute({
    ...f.context(),
    input: f.body(lines ?? [f.line(must(f.services[0]), '25.000', '0.000')]),
  });
  return { sessionId: result.session.id, lines: result.session.lines, recordedBy: result.session.recorded_by };
}

export function pairLines(f: CancelFixture) {
  const second = f.line(must(f.services[1]), '7.125', '0.000');
  return [f.line(must(f.services[0]), '25.000', '0.000'), { ...second, performers: [{ employee_id: must(f.employees[1]) }] }];
}

export async function cancelRows(f: CancelFixture, sessionId: string, lineId: string) {
  const cancellations = await f.h.owner`SELECT revision,previous_revision,previous_price::text,previous_discount::text,previous_net::text,
    reason,cancelled_by,cancelled_by_membership_id,cancelled_at,canceller_name_ar,canceller_name_en,canceller_role,
    canceller_role_is_system,canceller_role_name_ar,canceller_role_name_en
    FROM service_line_cancellations WHERE company_id=${f.company} AND line_id=${lineId}`;
  const audits = await f.h.owner`SELECT before,after FROM audit_log
    WHERE company_id=${f.company} AND entity_id=${lineId} AND action='service_line.cancelled'`;
  const events = await f.h.owner`SELECT payload FROM outbox
    WHERE company_id=${f.company} AND aggregate_id=${sessionId} AND event_type='ServiceLineChanged'`;
  const [line] = await f.h.owner`SELECT status,revision,price::text,discount::text,net::text,recorded_by
    FROM service_lines WHERE company_id=${f.company} AND id=${lineId}`;
  return { cancellations, audits, events, line: must(line) };
}

export async function cancelQuiet(f: CancelFixture, sessionId: string, lineId: string, key: string) {
  const cancellations = await f.h.owner`SELECT 1 FROM service_line_cancellations WHERE company_id=${f.company} AND line_id=${lineId}`;
  const audits = await f.h.owner`SELECT 1 FROM audit_log WHERE company_id=${f.company} AND entity_id=${lineId} AND action='service_line.cancelled'`;
  const events = await f.h.owner`SELECT 1 FROM outbox WHERE company_id=${f.company} AND aggregate_id=${sessionId} AND event_type='ServiceLineChanged'`;
  const keys = await f.h.owner`SELECT 1 FROM idempotency_keys WHERE company_id=${f.company} AND key=${key}`;
  return { cancellations: cancellations.length, audits: audits.length, events: events.length, keys: keys.length };
}

export async function sessionStamp(f: CancelFixture, sessionId: string) {
  const [row] = await f.h.owner`SELECT xmin::text AS xmin FROM service_sessions WHERE company_id=${f.company} AND id=${sessionId}`;
  return row?.['xmin'];
}

export async function performersOf(f: CancelFixture, lineId: string) {
  return f.h.owner`SELECT employee_id,share_bps FROM line_performers
    WHERE company_id=${f.company} AND line_id=${lineId} ORDER BY performer_ordinal`;
}

export async function cancelFootprint(f: CancelFixture) {
  const [row] = await f.h.owner`SELECT
    (SELECT count(*)::int FROM service_line_cancellations WHERE company_id IN (${f.company},${f.otherCompany})) AS cancellations,
    (SELECT count(*)::int FROM audit_log WHERE company_id IN (${f.company},${f.otherCompany}) AND action='service_line.cancelled') AS audits,
    (SELECT count(*)::int FROM outbox WHERE company_id IN (${f.company},${f.otherCompany}) AND event_type='ServiceLineChanged') AS events,
    (SELECT count(*)::int FROM idempotency_keys WHERE operation='cancel-service-line' AND company_id IN (${f.company},${f.otherCompany})) AS keys`;
  return row;
}

export function payloadOf(value: unknown): unknown {
  return typeof value === 'string' ? (JSON.parse(value) as unknown) : value;
}

export async function expectHidden(f: CancelFixture, sessionId: string, lineId: string, key: string, reason: string, result: unknown) {
  expect(JSON.stringify(result)).not.toContain(reason);
  const leaked = await f.h.owner`SELECT 1 FROM outbox WHERE company_id=${f.company} AND aggregate_id=${sessionId} AND payload::text LIKE ${'%' + reason + '%'}
    UNION ALL SELECT 1 FROM audit_log WHERE company_id=${f.company} AND entity_id=${lineId}
      AND (after::text LIKE ${'%' + reason + '%'} OR COALESCE(before::text,'') LIKE ${'%' + reason + '%'})
    UNION ALL SELECT 1 FROM idempotency_keys WHERE company_id=${f.company} AND key=${key} AND response_body::text LIKE ${'%' + reason + '%'}`;
  const [customer] = await f.h.owner`SELECT name,phone FROM customers WHERE company_id=${f.company} AND id=${f.customer}`;
  const rows = await cancelRows(f, sessionId, lineId);
  const [stored] = await f.h.owner`SELECT response_body::text AS body FROM idempotency_keys WHERE company_id=${f.company} AND key=${key}`;
  const packed = JSON.stringify({ result, events: rows.events, audits: rows.audits, stored: stored?.['body'] });
  expect(packed).not.toContain(String(customer?.['name']));
  expect(packed).not.toContain(String(customer?.['phone']));
  return leaked.length;
}

export async function scopedMember(f: CancelFixture, email: string, code: ScopeCode, scopeType: 'COMPANY' | 'BUSINESS' | 'BRANCH', scopeId: string) {
  await f.h.signedInOperator(email);
  const users = await f.h.owner`SELECT id FROM "user" WHERE email=${email}`;
  const userId = must(users[0])['id'] as string;
  const membershipId = ids.newId();
  const role = must(SYSTEM_ROLES.find((item) => item.code === code)).id;
  await f.h.owner`INSERT INTO memberships(company_id,id,user_id,role_id,role_owner_key,scope_type,scope_id,limit_bps,starts_at)
    VALUES(${f.company},${membershipId},${userId},${role},'global',${scopeType},${scopeId},NULL,'2026-01-01T00:00:00Z')`;
  return { userId, membershipId };
}

export async function cancelOnlyRole(f: CancelFixture, email: string) {
  await f.h.signedInOperator(email);
  const users = await f.h.owner`SELECT id FROM "user" WHERE email=${email}`;
  const userId = must(users[0])['id'] as string;
  const role = ids.newId();
  const membershipId = ids.newId();
  await f.h.owner`INSERT INTO roles(id,company_id,code,name_en) VALUES(${role},${f.company},'synthetic_line_canceller','Synthetic canceller')`;
  await f.h.owner`INSERT INTO role_permissions(role_id,role_owner_key,company_id,permission_code)
    VALUES(${role},${f.company},${f.company},'cancel:service-lines:branch')`;
  await f.h.owner`INSERT INTO memberships(company_id,id,user_id,role_id,role_owner_key,scope_type,scope_id,limit_bps,starts_at)
    VALUES(${f.company},${membershipId},${userId},${role},${f.company},'BRANCH',${f.branch},10000,'2026-01-01T00:00:00Z')`;
  return { userId, membershipId };
}
