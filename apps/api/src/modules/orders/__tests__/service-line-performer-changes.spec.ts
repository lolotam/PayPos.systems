import { afterAll, beforeAll, expect, it } from 'vitest';
import { serviceLinePerformerChangesPage } from '@pospay/contracts';
import { sql } from 'drizzle-orm';
import { applyChange, performer, type ChangeCtx, type Person } from '../../../../../../packages/db/test/service-line-performer-change.ts';
import { ordersLinePerformerChangeHistory } from '../orders.module.ts';
import { serviceLinePerformerChangesStatement } from '../queries/service-line-performer-changes.query.ts';
import { ids, interceptDatabase, must, sessionFixture, type SessionFixture } from './session.fixture.ts';

type Change = { revision: number; before: Person[]; after: Person[]; reason: string;
  changerNameAr?: string | null; changerNameEn?: string | null; changerRole?: string | null;
  roleIsSystem?: boolean | null; roleNameEn?: string | null };

let f: SessionFixture;
let sessionId = '';
let lineId = '';
let plainLineId = '';
let ownerMembership = '';

beforeAll(async () => {
  f = await sessionFixture();
  const saved = await f.create.execute({ ...f.context(), input: f.body([f.line(), f.line()]) });
  sessionId = saved.session.id;
  lineId = must(saved.session.lines[0]).id;
  plainLineId = must(saved.session.lines[1]).id;
  const [membership] = await f.h.owner`SELECT id FROM memberships WHERE company_id=${f.company} AND user_id=${f.ownerId}`;
  ownerMembership = String(must(membership)['id']);
  await seedChanges();
});
afterAll(async () => { await f?.close(); });

const history = () => ordersLinePerformerChangeHistory(f.db);
const scope = () => ({ ...f.context(), userId: f.ownerId, sessionId, lineId });
const read = (extra: { limit?: number; cursor?: string } = {}) => history().execute(scope(),
  { limit: extra.limit ?? 50, ...(extra.cursor === undefined ? {} : { cursor: extra.cursor }) });

async function seedChanges() {
  const [row] = await f.h.owner`SELECT service_id FROM service_lines WHERE company_id=${f.company} AND id=${lineId}`;
  const ctx: ChangeCtx = { company: f.company, business: f.business, branch: f.branch, userId: f.ownerId,
    membershipId: ownerMembership, sessionId, serviceId: String(must(row)['service_id']) };
  const first = await employeePerson(must(f.employees[0]));
  const second = await employeePerson(must(f.employees[1]));
  await change(ctx, { revision: 2, before: await livePeople(), after: [withShare(first, 1, 7000), withShare(second, 2, 3000)],
    reason: 'Split the colour and the rinse', changerNameAr: 'ليلى', changerNameEn: 'Layla' });
  await change(ctx, { revision: 3, before: await livePeople(), after: [withShare(first, 1, 10000)],
    reason: 'Rana left the branch before the visit', changerRole: 'owner', roleIsSystem: true, roleNameEn: 'Owner' });
  await change(ctx, { revision: 4, before: await livePeople(), after: [withShare(first, 1, 6000), withShare(second, 2, 4000)],
    reason: 'Corrected the split', changerRole: 'branch_manager', roleIsSystem: true, roleNameEn: 'Branch manager' });
}

// كل تغيير في معاملاته لوحده: القاعدة ترفض تغييرين لنفس السطر في نفس المعاملة.
async function change(ctx: ChangeCtx, planned: Change) {
  await f.db.withTenant(f.company, (tx) => applyChange(tx, ctx, ids, {
    lineId, previous: planned.revision - 1, revision: planned.revision,
    before: planned.before, live: planned.after, after: planned.after,
    reason: planned.reason, warning: planned.after.some((person) => person.clock || person.leave),
    changerNameAr: planned.changerNameAr ?? null, changerNameEn: planned.changerNameEn ?? null,
    changerRole: planned.changerRole ?? null, roleIsSystem: planned.roleIsSystem ?? null,
    roleNameAr: null, roleNameEn: planned.roleNameEn ?? null,
  }), { userId: f.ownerId });
}
async function livePeople(): Promise<Person[]> {
  const rows = await f.h.owner`SELECT employee_id, performer_ordinal, share_bps, linked_user_id, linked_user_snapshotted,
    name_en, name_ar, not_clocked_in_warning, approved_leave_warning
    FROM line_performers WHERE company_id=${f.company} AND line_id=${lineId} ORDER BY performer_ordinal`;
  return rows.map((row) => performer(String(row['employee_id']), {
    ordinal: Number(row['performer_ordinal']), share: Number(row['share_bps']),
    userId: textOrNull(row['linked_user_id']), nameEn: String(row['name_en']), nameAr: textOrNull(row['name_ar']),
    snapshotted: row['linked_user_snapshotted'] === true, clock: row['not_clocked_in_warning'] === true,
    leave: row['approved_leave_warning'] === true,
  }));
}
async function employeePerson(employeeId: string): Promise<Person> {
  const [row] = await f.h.owner`SELECT name_en, name_ar, user_id FROM employees WHERE company_id=${f.company} AND id=${employeeId}`;
  const employee = must(row);
  return performer(employeeId, { userId: textOrNull(employee['user_id']), nameEn: String(employee['name_en']),
    nameAr: textOrNull(employee['name_ar']), snapshotted: true });
}
function withShare(person: Person, ordinal: number, share: number): Person {
  return performer(person.employeeId, { ordinal, share, userId: person.userId, nameEn: person.nameEn,
    nameAr: person.nameAr, snapshotted: person.snapshotted, clock: person.clock, leave: person.leave });
}
function textOrNull(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

it('returns the newest change first with the stored names, shares, labels and reasons', async () => {
  const page = serviceLinePerformerChangesPage.parse(await read());
  expect(page.next_cursor).toBeNull();
  expect(page.items.map((item) => item.revision)).toEqual([4, 3, 2]);
  expect(page.items[0]).toMatchObject({ changer_label_ar: 'المدير', changer_label_en: 'Manager', reason: 'Corrected the split',
    before: [{ name_ar: null, name_en: 'Synthetic employee 0', share_bps: 10000 }],
    after: [{ name_ar: null, name_en: 'Synthetic employee 0', share_bps: 6000 },
      { name_ar: null, name_en: 'Synthetic employee 1', share_bps: 4000 }] });
  expect(page.items[1]).toMatchObject({ changer_label_ar: 'المالك', changer_label_en: 'Owner',
    reason: 'Rana left the branch before the visit',
    before: [{ name_ar: null, name_en: 'Synthetic employee 0', share_bps: 7000 },
      { name_ar: null, name_en: 'Synthetic employee 1', share_bps: 3000 }],
    after: [{ name_ar: null, name_en: 'Synthetic employee 0', share_bps: 10000 }] });
  expect(page.items[2]).toMatchObject({ changer_label_ar: 'ليلى', changer_label_en: 'Layla',
    reason: 'Split the colour and the rinse',
    before: [{ name_ar: null, name_en: 'Synthetic employee 0', share_bps: 10000 }],
    after: [{ name_ar: null, name_en: 'Synthetic employee 0', share_bps: 7000 },
      { name_ar: null, name_en: 'Synthetic employee 1', share_bps: 3000 }] });
  for (const item of page.items) expect(item.changed_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/);
  expect(await history().execute({ ...scope(), lineId: plainLineId }, { limit: 50 })).toEqual({ items: [], next_cursor: null });
});

it('returns no identity, no membership and no column of the change row', async () => {
  const payload = JSON.stringify(await read());
  for (const hidden of [f.ownerId, ownerMembership, ...f.employees, 'changed_by', 'membership', 'changer_name',
    'changer_role', 'previous_revision', 'write_xid', 'write_system_id', 'linked_user', 'employee_id',
    'performer_ordinal', 'warning']) {
    expect(payload).not.toContain(hidden);
  }
});

it('pages newest-first on limit 2 using the last included revision', async () => {
  const seen: number[] = [];
  let cursor: string | undefined;
  do {
    const page = await read({ limit: 2, ...(cursor === undefined ? {} : { cursor }) });
    expect(page.items.length).toBeGreaterThan(0);
    expect(page.items.length).toBeLessThanOrEqual(2);
    seen.push(...page.items.map((item) => item.revision));
    if (page.next_cursor !== null) {
      const decoded = JSON.parse(Buffer.from(page.next_cursor, 'base64url').toString('utf8')) as { revision: number };
      expect(decoded.revision).toBe(page.items[page.items.length - 1]?.revision);
    }
    cursor = page.next_cursor ?? undefined;
  } while (cursor !== undefined);
  expect(seen).toEqual([4, 3, 2]);
});

it('refuses a mismatched line, session, branch or tenant without saying which is missing', async () => {
  await expect(history().execute({ ...scope(), lineId: ids.newId() }, { limit: 50 })).rejects.toMatchObject({ code: 'FORBIDDEN' });
  await expect(history().execute({ ...scope(), sessionId: ids.newId() }, { limit: 50 })).rejects.toMatchObject({ code: 'FORBIDDEN' });
  const branchId = ids.newId();
  await f.h.owner`INSERT INTO branches(company_id,id,business_id,name_en) VALUES(${f.company},${branchId},${f.business},'Synthetic history branch')`;
  await expect(history().execute({ ...scope(), branchId }, { limit: 50 })).rejects.toMatchObject({ code: 'FORBIDDEN' });
  await expect(history().execute({ companyId: f.otherCompany, userId: f.ownerId, businessId: f.foreignBusiness,
    branchId: f.foreignBranch, sessionId, lineId }, { limit: 50 })).rejects.toMatchObject({ code: 'FORBIDDEN' });
});

it('refuses the change permission when the caller cannot read service sessions', async () => {
  await f.h.owner`INSERT INTO permission_overrides(company_id,id,membership_id,permission_code,effect,scope_type,scope_id,expires_at,reason,granted_by)
    VALUES(${f.company},${ids.newId()},${f.membership},'change:service-line-performers:branch','ALLOW','BRANCH',${f.branch},NULL,'Synthetic change without read',${f.ownerId})`;
  await expect(history().execute({ ...scope(), userId: f.userId }, { limit: 50 })).rejects.toMatchObject({ code: 'FORBIDDEN' });
  await f.h.owner`DELETE FROM permission_overrides WHERE company_id=${f.company} AND membership_id=${f.membership}`;
});

it('refuses the history read when the orders feature is disabled', async () => {
  await f.h.owner`INSERT INTO company_feature_overrides(company_id,flag,enabled,reason,set_by)
    VALUES(${f.company},'orders',false,'Synthetic history feature test',${f.ownerId})`;
  await expect(history().execute(scope(), { limit: 50 })).rejects.toMatchObject({ code: 'FEATURE_DISABLED' });
  await f.h.owner`DELETE FROM company_feature_overrides WHERE company_id=${f.company} AND flag='orders'`;
});

it('rejects a bad or foreign cursor before any tenant read', async () => {
  const statements: string[] = [];
  const guarded = ordersLinePerformerChangeHistory(interceptDatabase(f.db, async (statement) => { statements.push(statement); }));
  const decoded = JSON.parse(Buffer.from(must((await read({ limit: 2 })).next_cursor), 'base64url').toString('utf8')) as Record<string, unknown>;
  const foreign = Buffer.from(JSON.stringify({ ...decoded, line: ids.newId() })).toString('base64url');
  await expect(guarded.execute(scope(), { limit: 50, cursor: 'abc' })).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  await expect(guarded.execute(scope(), { limit: 50, cursor: foreign })).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  const oversized = Buffer.from(JSON.stringify({ ...decoded, revision: 2147483648 })).toString('base64url');
  await expect(guarded.execute(scope(), { limit: 50, cursor: oversized })).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  expect(statements).toHaveLength(0);
});

it('reads no row of another tenant', async () => {
  const statement = serviceLinePerformerChangesStatement(scope(), { limit: 50 });
  const rows = await f.db.withTenant(f.otherCompany, (tx) => tx.execute(statement));
  expect(rows).toHaveLength(0);
  const [changes] = await f.db.withTenant(f.otherCompany, (tx) => tx.execute(
    sql`SELECT count(*)::int AS total FROM service_line_performer_changes WHERE company_id=${f.company}`));
  expect(Number(must(changes)['total'])).toBe(0);
  const [sides] = await f.db.withTenant(f.otherCompany, (tx) => tx.execute(
    sql`SELECT count(*)::int AS total FROM service_line_performer_change_rows WHERE company_id=${f.company}`));
  expect(Number(must(sides)['total'])).toBe(0);
});
