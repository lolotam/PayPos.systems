import { afterAll, beforeAll, expect, it } from 'vitest';
import { serviceLineEditsPage } from '@pospay/contracts';
import { ordersLineEditHistory } from '../orders.module.ts';
import { seedPriceEdit } from './line-edit.helpers.ts';
import { ids, interceptDatabase, must, sessionFixture, type SessionFixture } from './session.fixture.ts';

let f: SessionFixture;
let sessionId = '';
let lineId = '';
let plainLineId = '';
const money = (price: string, discount: string, net: string) => [price, discount, net] as const;
beforeAll(async () => {
  f = await sessionFixture();
  const saved = await f.create.execute({ ...f.context(), input: f.body([f.line(), f.line()]) });
  sessionId = saved.session.id;
  lineId = must(saved.session.lines[0]).id;
  plainLineId = must(saved.session.lines[1]).id;
  const rows = [
    { revision: 6, nameAr: 'ليلى', nameEn: 'Layla Editor', role: 'branch_manager', reason: 'Corrected the price',
      previous: money('25.000', '1.000', '24.000'), next: money('22.000', '2.000', '20.000') },
    { revision: 5, role: 'owner', reason: 'Owner correction', previous: money('22.000', '2.000', '20.000'), next: money('21.000', '0.000', '21.000') },
    { revision: 4, role: 'general_manager', reason: 'General correction' },
    { revision: 3, role: 'business_manager', reason: 'Business correction' },
    { revision: 2, role: 'branch_manager', reason: 'Branch correction' },
  ];
  for (const row of rows) await seedPriceEdit(f, { lineId, changedAt: `2026-10-14T08:00:0${row.revision}.000000Z`, ...row });
});
afterAll(async () => { await f?.close(); });
const history = () => ordersLineEditHistory(f.db);
const scope = () => ({ ...f.context(), userId: f.ownerId, sessionId, lineId });
const read = (extra: { limit?: number; cursor?: string } = {}) => history().execute(scope(), { limit: extra.limit ?? 50, ...(extra.cursor === undefined ? {} : { cursor: extra.cursor }) });

it('returns newest edits first with money strings, labels and reason, and an untouched line stays empty', async () => {
  const page = serviceLineEditsPage.parse(await read());
  expect(page.next_cursor).toBeNull();
  expect(page.items.map((item) => item.revision)).toEqual([6, 5, 4, 3, 2]);
  expect(page.items[0]).toMatchObject({ changed_at: '2026-10-14T08:00:06.000000Z', reason: 'Corrected the price',
    previous: { price: '25.000', discount: '1.000', net: '24.000' }, new: { price: '22.000', discount: '2.000', net: '20.000' },
    editor_label_ar: 'ليلى', editor_label_en: 'Layla Editor' });
  expect(page.items[1]).toMatchObject({ editor_label_ar: 'المالك', editor_label_en: 'Owner', reason: 'Owner correction' });
  for (const item of page.items.slice(2)) {
    expect(item.editor_label_ar).toBe('المدير');
    expect(item.editor_label_en).toBe('Manager');
    expect(item.reason.length).toBeGreaterThan(0);
  }
  const payload = JSON.stringify(page);
  for (const hidden of [f.userId, f.membership, 'limit_bps', 'previous_revision', 'changed_by', 'editor_name', 'editor_role']) {
    expect(payload).not.toContain(hidden);
  }
  expect(await history().execute({ ...scope(), lineId: plainLineId }, { limit: 50 })).toEqual({ items: [], next_cursor: null });
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
  expect(seen).toEqual([6, 5, 4, 3, 2]);
});

it('refuses a mismatched line, session, branch or tenant without saying which is missing', async () => {
  await expect(history().execute({ ...scope(), lineId: ids.newId() }, { limit: 50 })).rejects.toMatchObject({ code: 'FORBIDDEN' });
  await expect(history().execute({ ...scope(), sessionId: ids.newId() }, { limit: 50 })).rejects.toMatchObject({ code: 'FORBIDDEN' });
  const branchId = ids.newId();
  await f.h.owner`INSERT INTO branches(company_id,id,business_id,name_en) VALUES(${f.company},${branchId},${f.business},'Synthetic history branch')`;
  await expect(history().execute({ ...scope(), branchId }, { limit: 50 })).rejects.toMatchObject({ code: 'FORBIDDEN' });
  await expect(history().execute({ companyId: f.otherCompany, userId: f.ownerId, businessId: f.foreignBusiness, branchId: f.foreignBranch, sessionId, lineId }, { limit: 50 }))
    .rejects.toMatchObject({ code: 'FORBIDDEN' });
});

it('refuses edit permission when the caller cannot read service sessions', async () => {
  await f.h.owner`INSERT INTO permission_overrides(company_id,id,membership_id,permission_code,effect,scope_type,scope_id,expires_at,reason,granted_by)
    VALUES(${f.company},${ids.newId()},${f.membership},'edit:service-line-prices:branch','ALLOW','BRANCH',${f.branch},NULL,'Synthetic edit without read',${f.ownerId})`;
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
  const guarded = ordersLineEditHistory(interceptDatabase(f.db, async (statement) => { statements.push(statement); }));
  const decoded = JSON.parse(Buffer.from(must((await read({ limit: 2 })).next_cursor), 'base64url').toString('utf8')) as Record<string, unknown>;
  const foreign = Buffer.from(JSON.stringify({ ...decoded, line: ids.newId() })).toString('base64url');
  await expect(guarded.execute(scope(), { limit: 50, cursor: 'abc' })).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  await expect(guarded.execute(scope(), { limit: 50, cursor: foreign })).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  expect(statements).toHaveLength(0);
});
