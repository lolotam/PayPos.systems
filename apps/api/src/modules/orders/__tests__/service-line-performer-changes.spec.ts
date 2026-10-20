import { afterAll, beforeAll, expect, it } from 'vitest';
import { serviceLinePerformerChangesPage } from '@pospay/contracts';
import { sql } from 'drizzle-orm';
import { ordersLinePerformerChangeHistory } from '../orders.module.ts';
import { serviceLinePerformerChangesStatement } from '../queries/service-line-performer-changes.query.ts';
import {
  changeContext,
  commitPerformerChange,
  employeePerson,
  livePeople,
  ownerMembershipOf,
  withShare,
} from './performer-change-history.helpers.ts';
import { ids, interceptDatabase, must, sessionFixture, type SessionFixture } from './session.fixture.ts';

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
  ownerMembership = await ownerMembershipOf(f);
  await seedChanges();
});
afterAll(async () => { await f?.close(); });

const history = () => ordersLinePerformerChangeHistory(f.db);
const scope = () => ({ ...f.context(), userId: f.ownerId, sessionId, lineId });
const read = (extra: { limit?: number; cursor?: string } = {}) => history().execute(scope(),
  { limit: extra.limit ?? 50, ...(extra.cursor === undefined ? {} : { cursor: extra.cursor }) });

async function seedChanges() {
  const ctx = await changeContext(f, sessionId, lineId, ownerMembership);
  const first = await employeePerson(f, must(f.employees[0]));
  const second = await employeePerson(f, must(f.employees[1]));
  await commitPerformerChange(f, ctx, lineId, { revision: 2, before: await livePeople(f, lineId),
    after: [withShare(first, 1, 7000), withShare(second, 2, 3000)],
    reason: 'Split the colour and the rinse', changerNameAr: 'ليلى', changerNameEn: 'Layla' });
  await commitPerformerChange(f, ctx, lineId, { revision: 3, before: await livePeople(f, lineId),
    after: [withShare(first, 1, 10000)], reason: 'Rana left the branch before the visit',
    changerNameEn: null, changerRole: 'owner', roleIsSystem: true, roleNameEn: 'Owner' });
  await commitPerformerChange(f, ctx, lineId, { revision: 4, before: await livePeople(f, lineId),
    after: [withShare(first, 1, 6000), withShare(second, 2, 4000)], reason: 'Corrected the split',
    changerNameEn: null, changerRole: 'branch_manager', roleIsSystem: true, roleNameEn: 'Branch manager' });
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
