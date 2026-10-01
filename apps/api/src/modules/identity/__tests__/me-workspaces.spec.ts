import { errorEnvelope, myWorkspacesResponse, type MyWorkspacesResponse } from '@pospay/contracts';
import { SYSTEM_ROLES } from '@pospay/db';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { startHarness, type Harness } from '../../../../test/harness.ts';

const EMPTY_EMAIL = 'workspaces-empty@example.test';
const OWNER_EMAIL = 'workspaces-owner@example.test';
const OTHER_EMAIL = 'workspaces-other@example.test';

let h: Harness;
let ownerCookie: string;
let otherCookie: string;
let emptyCookie: string;
let emptyUserId: string;
let companyA: string;
let companyB: string;
let northId: string;
let southId: string;
let eastId: string;
let westId: string;
let riyadhId: string;

function roleId(code: string): string {
  const found = SYSTEM_ROLES.find((role) => role.code === code);
  if (found === undefined) throw new Error(`missing role ${code}`);
  return found.id;
}

async function userId(email: string): Promise<string> {
  const [row] = await h.owner`SELECT id FROM "user" WHERE email = ${email}`;
  if (row === undefined || typeof row['id'] !== 'string') throw new Error(`no user ${email}`);
  return row['id'];
}

async function signIn(): Promise<void> {
  emptyCookie = await h.signedInOperator(EMPTY_EMAIL);
  ownerCookie = await h.signedInOperator(OWNER_EMAIL);
  otherCookie = await h.signedInOperator(OTHER_EMAIL);
  emptyUserId = await userId(EMPTY_EMAIL);
  companyA = await h.onboard(ownerCookie, 'Alpha Co');
  companyB = await h.onboard(otherCookie, 'Beta Co');
}

async function createBusiness(name: string, timezone?: string): Promise<string> {
  const res = await h.send('POST', '/v1/businesses', {
    cookie: ownerCookie,
    company: companyA,
    key: `ws-${name.replaceAll(' ', '-')}`,
    body: {
      vertical_type: 'retail',
      name_en: name,
      ...(timezone === undefined ? {} : { timezone }),
    },
  });
  expect(res.status).toBe(201);
  if (typeof res.body['id'] !== 'string') throw new Error(`business ${name} has no id`);
  return res.body['id'];
}

async function createBranch(businessId: string, name: string, timezone?: string): Promise<string> {
  const res = await h.send('POST', `/v1/businesses/${businessId}/branches`, {
    cookie: ownerCookie,
    company: companyA,
    key: `ws-${name.replaceAll(' ', '-')}`,
    body: { name_en: name, ...(timezone === undefined ? {} : { timezone }) },
  });
  expect(res.status).toBe(201);
  if (typeof res.body['id'] !== 'string') throw new Error(`branch ${name} has no id`);
  return res.body['id'];
}

async function buildTree(): Promise<void> {
  northId = await createBusiness('North Shop', 'Asia/Qatar');
  southId = await createBusiness('South Shop');
  eastId = await createBranch(northId, 'East');
  westId = await createBranch(northId, 'West');
  riyadhId = await createBranch(southId, 'Riyadh Desk', 'Asia/Riyadh');
}

async function list(cookie: string): Promise<MyWorkspacesResponse> {
  const res = await h.send('GET', '/v1/me/workspaces', { cookie });
  expect(res.status).toBe(200);
  return myWorkspacesResponse.parse(res.body);
}

async function endMemberships(user: string): Promise<void> {
  await h.owner`
    UPDATE memberships
    SET starts_at = now() - interval '2 minutes', ends_at = now() - interval '1 minute'
    WHERE user_id = ${user} AND (ends_at IS NULL OR ends_at > now())`;
}

async function grant(input: {
  company: string;
  scope: 'COMPANY' | 'BUSINESS' | 'BRANCH';
  scopeId: string;
  role: string;
  starts?: string;
}): Promise<void> {
  await h.owner`
    INSERT INTO memberships (
      company_id, id, user_id, role_id, role_owner_key, scope_type, scope_id, starts_at
    ) VALUES (
      ${input.company}, ${randomUUID()}, ${emptyUserId}, ${input.role}, 'global',
      ${input.scope}, ${input.scopeId}, ${input.starts ?? new Date(Date.now() - 60_000).toISOString()}::timestamptz
    )`;
}

function ownerTree() {
  return {
    companies: [
      {
        id: companyA,
        name_ar: null,
        name_en: 'Alpha Co',
        role_code: 'owner',
        scope: 'COMPANY' as const,
        businesses: [
          {
            id: northId,
            name_ar: null,
            name_en: 'North Shop',
            branches: [
              {
                id: eastId,
                name_ar: null,
                name_en: 'East',
                effective_timezone: 'Asia/Qatar',
                is_active: true,
              },
              {
                id: westId,
                name_ar: null,
                name_en: 'West',
                effective_timezone: 'Asia/Qatar',
                is_active: true,
              },
            ],
          },
          {
            id: southId,
            name_ar: null,
            name_en: 'South Shop',
            branches: [
              {
                id: riyadhId,
                name_ar: null,
                name_en: 'Riyadh Desk',
                effective_timezone: 'Asia/Riyadh',
                is_active: true,
              },
            ],
          },
        ],
      },
    ],
  };
}

beforeAll(async () => {
  h = await startHarness();
  await signIn();
  await buildTree();
}, 120_000);

afterAll(async () => {
  await h.close();
});

describe('GET /v1/me/workspaces without a usable membership', () => {
  it('refuses a request with no session', async () => {
    const res = await h.app.inject({ method: 'GET', url: '/v1/me/workspaces' });
    expect(res.statusCode).toBe(401);
    expect(errorEnvelope.parse(res.json()).code).toBe('UNAUTHENTICATED');
  });

  it('returns an empty list for a signed-in user with no membership', async () => {
    expect(await list(emptyCookie)).toEqual({ companies: [] });
  });

  it('ignores an ended membership and one that has not started', async () => {
    await h.owner`
      INSERT INTO memberships (
        company_id, id, user_id, role_id, role_owner_key, scope_type, scope_id, starts_at, ends_at
      ) VALUES (
        ${companyA}, ${randomUUID()}, ${emptyUserId}, ${roleId('cashier')}, 'global', 'COMPANY', ${companyA},
        '2020-01-01T00:00:00Z', '2020-02-01T00:00:00Z'
      )`;
    await grant({
      company: companyA,
      scope: 'COMPANY',
      scopeId: companyA,
      role: roleId('cashier'),
      starts: '2999-01-01T00:00:00Z',
    });
    expect(await list(emptyCookie)).toEqual({ companies: [] });
  });
});

describe('GET /v1/me/workspaces for an owner', () => {
  it('shows the owner every business and branch, with the effective time zone', async () => {
    const body = await list(ownerCookie);
    expect(body).toEqual(ownerTree());
  });

  it('never returns another company the user is not a member of', async () => {
    const mine = await list(ownerCookie);
    const theirs = await list(otherCookie);
    expect(mine.companies.map((company) => company.id)).toEqual([companyA]);
    expect(theirs.companies.map((company) => company.id)).toEqual([companyB]);
    expect(JSON.stringify(mine)).not.toContain('Beta Co');
    expect(JSON.stringify(theirs)).not.toContain('Alpha Co');
    expect(JSON.stringify(mine)).not.toContain(companyB);
    expect(JSON.stringify(theirs)).not.toContain(companyA);
  });
});

describe('GET /v1/me/workspaces for a business scope', () => {
  it('a BUSINESS membership sees that business and only its branches', async () => {
    await endMemberships(emptyUserId);
    await grant({
      company: companyA,
      scope: 'BUSINESS',
      scopeId: northId,
      role: roleId('business_manager'),
    });
    const [company] = (await list(emptyCookie)).companies;
    expect(company).toMatchObject({
      id: companyA,
      role_code: 'business_manager',
      scope: 'BUSINESS',
    });
    expect(company?.businesses.map((business) => business.id)).toEqual([northId]);
    expect(company?.businesses[0]?.branches.map((branch) => branch.id)).toEqual([eastId, westId]);
  });
});

describe('GET /v1/me/workspaces for a branch scope', () => {
  it('a BRANCH membership sees that branch and its parent business', async () => {
    await endMemberships(emptyUserId);
    await grant({
      company: companyA,
      scope: 'BRANCH',
      scopeId: riyadhId,
      role: roleId('branch_manager'),
    });
    const [company] = (await list(emptyCookie)).companies;
    expect(company).toMatchObject({ id: companyA, role_code: 'branch_manager', scope: 'BRANCH' });
    expect(company?.businesses).toEqual([
      {
        id: southId,
        name_ar: null,
        name_en: 'South Shop',
        branches: [
          {
            id: riyadhId,
            name_ar: null,
            name_en: 'Riyadh Desk',
            effective_timezone: 'Asia/Riyadh',
            is_active: true,
          },
        ],
      },
    ]);
  });
});

describe('GET /v1/me/workspaces across companies', () => {
  it('lists both companies by name and keeps every scope under the widest role', async () => {
    await endMemberships(emptyUserId);
    await grant({
      company: companyA,
      scope: 'COMPANY',
      scopeId: companyA,
      role: roleId('cashier'),
    });
    await grant({ company: companyB, scope: 'COMPANY', scopeId: companyB, role: roleId('viewer') });
    const both = await list(emptyCookie);
    expect(
      both.companies.map((company) => [company.name_en, company.role_code, company.scope]),
    ).toEqual([
      ['Alpha Co', 'cashier', 'COMPANY'],
      ['Beta Co', 'viewer', 'COMPANY'],
    ]);
    await endMemberships(emptyUserId);
    await grant({
      company: companyA,
      scope: 'BUSINESS',
      scopeId: northId,
      role: roleId('business_manager'),
      starts: '2020-01-01T00:00:00Z',
    });
    await grant({
      company: companyA,
      scope: 'BRANCH',
      scopeId: riyadhId,
      role: roleId('cashier'),
      starts: '2024-01-01T00:00:00Z',
    });
    const [company] = (await list(emptyCookie)).companies;
    expect(company).toMatchObject({ role_code: 'business_manager', scope: 'BUSINESS' });
    expect(
      company?.businesses.map((business) => ({
        id: business.id,
        branches: business.branches.map((branch) => branch.id),
      })),
    ).toEqual([
      { id: northId, branches: [eastId, westId] },
      { id: southId, branches: [riyadhId] },
    ]);
  });
});
