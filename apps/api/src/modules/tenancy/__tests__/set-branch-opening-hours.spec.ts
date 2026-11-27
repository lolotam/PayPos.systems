import { errorEnvelope } from '@pospay/contracts';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createTenancyTransactions } from '../persistence/tenancy-transactions.ts';
import { SetBranchOpeningHours } from '../use-cases/set-branch-opening-hours/set-branch-opening-hours.ts';
import { permissionFixture, type PermissionFixture } from '../../../../test/permissions-fixture.ts';

// تعديل مواعيد عمل الفرع بعد إنشائه (PENDING-T3) عبر الـ API على Postgres حقيقي: تغيير واحد مُدوَّن،
// والمواعيد المتساوية المعنى بلا كتابة ولا تدقيق، ومسح المواعيد، والرفض 400 للتداخل، و403 للنشاط الأجنبي
// ولمن لا يملك الصلاحية، و404 لفرع نشاط آخر في نفس الشركة وفرع شركة أخرى (عزل RLS).

let f: PermissionFixture;
let foreignBusiness: string;
let siblingBusinessBranch: string;

const week = (...days: [number, string, string][]) =>
  days.map(([weekday, opens, closes]) => ({ weekday, intervals: [{ opens, closes }] }));
const MON_TO_WED = week([1, '09:00', '17:00'], [2, '09:00', '17:00'], [3, '10:00', '14:00']);

beforeAll(async () => {
  f = await permissionFixture();
  const [row] = await f.h
    .owner`SELECT business_id FROM branches WHERE company_id = ${f.otherCompany} AND id = ${f.foreignBranch}`;
  foreignBusiness = row?.['business_id'] as string;
  siblingBusinessBranch = f.ids.newId();
  await f.h.owner`INSERT INTO branches (company_id, id, business_id, name_en)
    VALUES (${f.company}, ${siblingBusinessBranch}, ${f.otherBusiness}, 'Sibling business branch')`;
});

afterAll(async () => {
  await f?.db.close();
  await f?.h.close();
});

const put = (body: object, { cookie = f.cookie, business = f.business, branch = f.branch } = {}) =>
  f.h.send('PUT', `/v1/businesses/${business}/branches/${branch}/opening-hours`, {
    cookie,
    company: f.company,
    body,
  });

const storedHours = async (branch = f.branch, company = f.company): Promise<unknown> => {
  const [row] = await f.h
    .owner`SELECT opening_hours FROM branches WHERE company_id = ${company} AND id = ${branch}`;
  return row?.['opening_hours'];
};

const hourAudits = async (branch = f.branch, company = f.company) =>
  f.h.owner`SELECT before, after FROM audit_log
    WHERE company_id = ${company} AND entity = 'branch' AND entity_id = ${branch}
      AND action = 'opening_hours.changed' ORDER BY id`;

describe('replacing the opening hours', () => {
  it('stores the first hours, answers the branch and audits null before them', async () => {
    const res = await put({ opening_hours: MON_TO_WED });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      id: f.branch,
      business_id: f.business,
      opening_hours: MON_TO_WED,
    });
    expect(await storedHours()).toEqual(MON_TO_WED);
    expect(await hourAudits()).toEqual([
      { before: { opening_hours: null }, after: { opening_hours: MON_TO_WED } },
    ]);
  });

  it('reads the new hours back through the branch read route', async () => {
    const read = await f.h.send('GET', `/v1/branches/${f.branch}`, {
      cookie: f.cookie,
      company: f.company,
    });
    expect(read.status).toBe(200);
    expect(read.body['opening_hours']).toEqual(MON_TO_WED);
  });

  it('changes the hours and audits the previous and the new value', async () => {
    const next = week([1, '08:00', '20:00']);
    const res = await put({ opening_hours: next });
    expect(res.status).toBe(200);
    expect(await storedHours()).toEqual(next);
    const audits = await hourAudits();
    expect(audits).toHaveLength(2);
    expect(audits[1]).toEqual({
      before: { opening_hours: MON_TO_WED },
      after: { opening_hours: next },
    });
  });
});

describe('replacing the opening hours (unchanged and cleared)', () => {
  it('answers 200 for the same hours written in another order without an UPDATE or an audit row', async () => {
    const statementsBefore = f.h.calls.statements.length;
    const reordered = [...week([1, '08:00', '20:00'])].reverse();
    const res = await put({ opening_hours: reordered });
    expect(res.status).toBe(200);
    expect(await hourAudits()).toHaveLength(2);
    const fresh = f.h.calls.statements.slice(statementsBefore);
    expect(fresh.filter((statement) => /UPDATE\s+branches/i.test(statement.sql))).toEqual([]);
  });

  it('clears the hours with null and audits the value that was cleared', async () => {
    const res = await put({ opening_hours: null });
    expect(res.status).toBe(200);
    expect(res.body['opening_hours']).toBeNull();
    expect(await storedHours()).toBeNull();
    const audits = await hourAudits();
    expect(audits).toHaveLength(3);
    expect(audits[2]?.['after']).toEqual({ opening_hours: null });
    const again = await put({ opening_hours: null });
    expect(again.status).toBe(200);
    expect(await hourAudits()).toHaveLength(3);
  });

  it('keeps an empty week (closed all week) different from no hours at all', async () => {
    const res = await put({ opening_hours: [] });
    expect(res.status).toBe(200);
    expect(await storedHours()).toEqual([]);
    expect(await hourAudits()).toHaveLength(4);
  });
});

describe('the refusals', () => {
  it.each([
    [
      'overlapping intervals',
      {
        opening_hours: [
          {
            weekday: 1,
            intervals: [
              { opens: '09:00', closes: '13:00' },
              { opens: '12:00', closes: '15:00' },
            ],
          },
        ],
      },
    ],
    [
      'a repeated weekday',
      { opening_hours: [...week([1, '09:00', '12:00']), ...week([1, '13:00', '17:00'])] },
    ],
    ['a malformed clock', { opening_hours: week([1, '9:00', '17:00']) }],
    ['a missing key', {}],
    ['an unknown key', { opening_hours: null, is_active: false }],
  ])('refuses %s with 400 and leaves the row unchanged', async (_label, body) => {
    const before = await storedHours();
    const auditsBefore = await hourAudits();
    const res = await put(body);
    expect(res.status).toBe(400);
    expect(errorEnvelope.parse(res.body).code).toBe('VALIDATION_FAILED');
    expect(await storedHours()).toEqual(before);
    expect(await hourAudits()).toHaveLength(auditsBefore.length);
  });

  it('refuses a malformed branch id with 400', async () => {
    const res = await put({ opening_hours: null }, { branch: 'not-a-uuid' });
    expect(res.status).toBe(400);
  });

  it('answers a foreign business with the business-scoped 403 and writes nothing', async () => {
    const foreignBefore = await storedHours(f.foreignBranch, f.otherCompany);
    const res = await put(
      { opening_hours: MON_TO_WED },
      { business: foreignBusiness, branch: f.foreignBranch },
    );
    expect(res.status).toBe(403);
    expect(errorEnvelope.parse(res.body).code).toBe('FORBIDDEN');
    expect(await storedHours(f.foreignBranch, f.otherCompany)).toEqual(foreignBefore);
    expect(await hourAudits(f.foreignBranch, f.otherCompany)).toEqual([]);
  });

  it('refuses a member without the branch-creation permission with the 403 envelope', async () => {
    const before = await storedHours();
    const res = await put({ opening_hours: MON_TO_WED }, { cookie: f.managerCookie });
    expect(res.status).toBe(403);
    expect(errorEnvelope.parse(res.body).code).toBe('FORBIDDEN');
    expect(await storedHours()).toEqual(before);
  });
});

describe('the branch must belong to the business in the path', () => {
  it('answers 404 for a branch of another business of the same company and writes nothing', async () => {
    const res = await put(
      { opening_hours: MON_TO_WED },
      { business: f.business, branch: siblingBusinessBranch },
    );
    expect(res.status).toBe(404);
    expect(errorEnvelope.parse(res.body).code).toBe('NOT_FOUND');
    expect(await storedHours(siblingBusinessBranch)).toBeNull();
    expect(await hourAudits(siblingBusinessBranch)).toEqual([]);
  });

  it('answers 404 for an unknown branch and for a branch of another company', async () => {
    const unknown = await put(
      { opening_hours: MON_TO_WED },
      { branch: '01920000-0000-7000-8000-00000000ffff' },
    );
    expect(unknown.status).toBe(404);
    const foreignBefore = await storedHours(f.foreignBranch, f.otherCompany);
    const foreign = await put({ opening_hours: MON_TO_WED }, { branch: f.foreignBranch });
    expect(foreign.status).toBe(404);
    expect(await storedHours(f.foreignBranch, f.otherCompany)).toEqual(foreignBefore);
  });

  it('cannot reach the row through another tenant RLS context', async () => {
    const touched = await f.db.withTenant(f.otherCompany, (tx) =>
      tx.execute(
        sql`UPDATE branches SET opening_hours = '[]'::jsonb WHERE id = ${f.branch} RETURNING id`,
      ),
    );
    expect(Array.from(touched)).toEqual([]);
  });
});

describe('audit-failure rollback', () => {
  it('rolls the hours write back and records no audit row when the audit fails', async () => {
    const before = await storedHours();
    const auditsBefore = (await hourAudits()).length;
    const real = createTenancyTransactions(f.db, f.ids);
    const useCase = new SetBranchOpeningHours({
      ...real,
      runBranchOpeningHoursChange: (context, work) =>
        real.runBranchOpeningHoursChange(context, (scope) =>
          work({
            ...scope,
            audit: {
              record: async () => {
                throw new Error('Synthetic audit failure');
              },
            },
          }),
        ),
    });
    await expect(
      useCase.execute({
        companyId: f.company,
        userId: f.userId,
        businessId: f.business,
        branchId: f.branch,
        input: { opening_hours: week([5, '10:00', '22:00']) },
      }),
    ).rejects.toThrow('Synthetic audit failure');
    expect(await storedHours()).toEqual(before);
    expect(await hourAudits()).toHaveLength(auditsBefore);
  });
});
