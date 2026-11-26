import { myWorkspacesResponse, type MyWorkspacesResponse } from '@pospay/contracts';
import { SYSTEM_ROLES } from '@pospay/db';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { startHarness, type Harness } from '../../../../test/harness.ts';

const OWNER_EMAIL = 'workspaces-logo-owner@example.test';
const MEMBER_EMAIL = 'workspaces-logo-member@example.test';

let h: Harness;
let ownerCookie: string;
let memberCookie: string;
let memberUserId: string;
let companyId: string;
let northId: string;
let eastId: string;

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

async function list(cookie: string): Promise<MyWorkspacesResponse> {
  const res = await h.send('GET', '/v1/me/workspaces', { cookie });
  expect(res.status).toBe(200);
  return myWorkspacesResponse.parse(res.body);
}

/** يربط ملف شعار بالنشاط؛ الـ foreign key بيفرض إنشاء الملف قبل الربط. */
async function bindLogo(businessId: string): Promise<string> {
  const fileId = randomUUID();
  await h.owner`
    INSERT INTO file_objects (
      company_id, id, business_id, owner_module, owner_entity_id, staging_key, storage_key,
      content_type, size_bytes, required_permission, created_by, created_at, status
    ) VALUES (
      ${companyId}, ${fileId}, ${businessId}, 'settings', ${businessId}, ${`staging-${fileId}`},
      ${`verified-${fileId}`}, 'image/png', 10, 'manage:business-identity:business',
      ${memberUserId}, now(), 'READY'
    )`;
  await h.owner`
    INSERT INTO business_settings (company_id, business_id, logo_file_id)
    VALUES (${companyId}, ${businessId}, ${fileId})
    ON CONFLICT (company_id, business_id) DO UPDATE SET logo_file_id = EXCLUDED.logo_file_id`;
  return fileId;
}

async function clearLogo(businessId: string): Promise<void> {
  await h.owner`
    UPDATE business_settings SET logo_file_id = NULL
    WHERE company_id = ${companyId} AND business_id = ${businessId}`;
}

async function grantMember(scopeType: 'BUSINESS' | 'BRANCH', scopeId: string, code: string) {
  await h.owner`
    INSERT INTO memberships (
      company_id, id, user_id, role_id, role_owner_key, scope_type, scope_id, starts_at
    ) VALUES (
      ${companyId}, ${randomUUID()}, ${memberUserId}, ${roleId(code)}, 'global', ${scopeType},
      ${scopeId}, '2024-01-01T00:00:00Z'::timestamptz
    )`;
}

async function endMemberMemberships(): Promise<void> {
  await h.owner`
    UPDATE memberships SET ends_at = now() - interval '1 minute'
    WHERE user_id = ${memberUserId} AND (ends_at IS NULL OR ends_at > now())`;
}

beforeAll(async () => {
  h = await startHarness();
  ownerCookie = await h.signedInOperator(OWNER_EMAIL);
  memberCookie = await h.signedInOperator(MEMBER_EMAIL);
  memberUserId = await userId(MEMBER_EMAIL);
  companyId = await h.onboard(ownerCookie, 'Logo Co');
  const business = await h.send('POST', '/v1/businesses', {
    cookie: ownerCookie,
    company: companyId,
    key: 'logo-north',
    body: { vertical_type: 'salon', name_en: 'North' },
  });
  expect(business.status).toBe(201);
  northId = business.body['id'] as string;
  const branch = await h.send('POST', `/v1/businesses/${northId}/branches`, {
    cookie: ownerCookie,
    company: companyId,
    key: 'logo-east',
    body: { name_en: 'East' },
  });
  expect(branch.status).toBe(201);
  eastId = branch.body['id'] as string;
}, 120_000);

afterAll(async () => {
  await h.close();
});

describe('GET /v1/me/workspaces with a bound business logo (079 TQ-1)', () => {
  it('shows the logo to a non-owner business member', async () => {
    const fileId = await bindLogo(northId);
    await endMemberMemberships();
    await grantMember('BUSINESS', northId, 'business_manager');
    const [company] = (await list(memberCookie)).companies;
    expect(company?.businesses.map((business) => business.id)).toEqual([northId]);
    expect(company?.businesses[0]?.logo_file_id).toBe(fileId);
  });

  it('shows the logo to a branch member of the parent business', async () => {
    const fileId = await bindLogo(northId);
    await endMemberMemberships();
    await grantMember('BRANCH', eastId, 'branch_manager');
    const [company] = (await list(memberCookie)).companies;
    expect(company?.businesses.map((business) => business.id)).toEqual([northId]);
    expect(company?.businesses[0]?.logo_file_id).toBe(fileId);
  });

  it('omits logo_file_id when a covered business has no bound logo', async () => {
    await bindLogo(northId);
    await clearLogo(northId);
    await endMemberMemberships();
    await grantMember('BUSINESS', northId, 'business_manager');
    const [company] = (await list(memberCookie)).companies;
    expect(company?.businesses.map((business) => business.id)).toEqual([northId]);
    expect(Object.keys(company?.businesses[0] ?? {})).not.toContain('logo_file_id');
  });

  it('does not return a business or its bound logo when the member does not cover that business', async () => {
    const southRes = await h.send('POST', '/v1/businesses', {
      cookie: ownerCookie,
      company: companyId,
      key: 'logo-south',
      body: { vertical_type: 'salon', name_en: 'South' },
    });
    expect(southRes.status).toBe(201);
    const southId = southRes.body['id'] as string;
    await bindLogo(southId);
    await endMemberMemberships();
    await grantMember('BUSINESS', northId, 'business_manager');
    const [company] = (await list(memberCookie)).companies;
    expect(company?.businesses.map((business) => business.id)).toEqual([northId]);
    expect(company?.businesses.some((business) => business.id === southId)).toBe(false);
  });
});
