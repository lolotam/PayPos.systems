import { SYSTEM_ROLES } from '@pospay/db';
import { ids, must, type SessionFixture } from './session.fixture.ts';

export const EDIT_REASON = 'Synthetic edit reason';
const managerRole = must(SYSTEM_ROLES.find((role) => role.code === 'branch_manager')).id;
type Discount = { kind: 'AMOUNT'; amount: string } | { kind: 'PERCENT'; bps: number };
type EditPatch = { price?: string; discount?: Discount; reason?: string; expected_revision?: number; editor_membership_id?: string };
type EditOptions = { userId?: string; key?: string; fingerprint?: string };

export async function recorded(f: SessionFixture, price = '25.000', discount = '2.500', performers?: { employee_id: string }[]) {
  const base = f.line(must(f.services[0]), price, discount);
  const result = await f.create.execute({ ...f.context(), input: f.body([performers === undefined ? base : { ...base, performers }]) });
  const saved = must(result.session.lines[0]);
  return { sessionId: result.session.id, lineId: saved.id, recordedBy: result.session.recorded_by };
}

export function editBody(patch: EditPatch = {}) {
  return {
    price: patch.price ?? '25.000',
    discount: patch.discount ?? { kind: 'AMOUNT' as const, amount: '5.000' },
    reason: patch.reason ?? EDIT_REASON,
    expected_revision: patch.expected_revision ?? 1,
    ...(patch.editor_membership_id === undefined ? {} : { editor_membership_id: patch.editor_membership_id }),
  };
}

export function runEdit(f: SessionFixture, sessionId: string, lineId: string, input: ReturnType<typeof editBody>, options: EditOptions = {}) {
  return f.edit.execute({ ...f.context(options.key ?? ids.newId(), options.userId ?? f.editorId, options.fingerprint), sessionId, lineId, input });
}

export async function editRows(f: SessionFixture, sessionId: string, lineId: string) {
  const edits = await f.h.owner`SELECT revision,previous_revision,previous_price::text,previous_discount::text,previous_net::text,
    new_price::text,new_discount::text,new_net::text,previous_effective_discount_bps,previous_limit_bps_applied,previous_limit_source,
    new_effective_discount_bps,new_limit_bps_applied,new_limit_source,reason,changed_by,changed_by_membership_id,
    editor_name_ar,editor_name_en,editor_role,editor_role_is_system,editor_role_name_ar,editor_role_name_en
    FROM service_line_edits WHERE company_id=${f.company} AND line_id=${lineId} ORDER BY revision`;
  const audits = await f.h.owner`SELECT after FROM audit_log WHERE company_id=${f.company} AND entity_id=${lineId} AND action='service_line.price_discount_edited'`;
  const events = await f.h.owner`SELECT payload FROM outbox WHERE company_id=${f.company} AND aggregate_id=${sessionId} AND event_type='ServiceLineChanged'`;
  const [line] = await f.h.owner`SELECT revision,price::text,discount::text,net::text,limit_source,limit_bps_applied,recorded_by,effective_discount_bps
    FROM service_lines WHERE company_id=${f.company} AND id=${lineId}`;
  return { edits, audits, events, line: must(line) };
}

export async function quietCounts(f: SessionFixture, sessionId: string, lineId: string, key: string) {
  const edits = await f.h.owner`SELECT 1 FROM service_line_edits WHERE company_id=${f.company} AND line_id=${lineId}`;
  const audits = await f.h.owner`SELECT 1 FROM audit_log WHERE company_id=${f.company} AND entity_id=${lineId} AND action='service_line.price_discount_edited'`;
  const events = await f.h.owner`SELECT 1 FROM outbox WHERE company_id=${f.company} AND aggregate_id=${sessionId} AND event_type='ServiceLineChanged'`;
  const keys = await f.h.owner`SELECT 1 FROM idempotency_keys WHERE company_id=${f.company} AND key=${key}`;
  return { edits: edits.length, audits: audits.length, events: events.length, keys: keys.length };
}

export async function branchManager(f: SessionFixture, email: string) {
  await f.h.signedInOperator(email);
  const users = await f.h.owner`SELECT id FROM "user" WHERE email=${email}`;
  const userId = must(users[0])['id'] as string;
  const membershipId = ids.newId();
  await f.h.owner`INSERT INTO memberships(company_id,id,user_id,role_id,role_owner_key,scope_type,scope_id,limit_bps,starts_at)
    VALUES(${f.company},${membershipId},${userId},${managerRole},'global','BRANCH',${f.branch},2000,'2026-01-01T00:00:00Z')`;
  return { userId, membershipId };
}
