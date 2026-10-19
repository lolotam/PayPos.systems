import { businessIdentity, identityCapability } from '@pospay/contracts';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, expect, it } from 'vitest';

import {
  permissionFixture,
  seedOverride,
  type PermissionFixture,
} from '../../../../test/permissions-fixture.ts';
import { identityCapabilityAccess } from '../persistence/business-identity-access.adapter.ts';
import {
  identityCapabilityBusinessStatement,
  readIdentityCapability,
} from '../queries/identity-capability.query.ts';

let f: PermissionFixture;
let deniedBody = '';

beforeAll(async () => {
  f = await permissionFixture();
});
afterAll(async () => {
  await f?.db.close();
  await f?.h.close();
});

function read(cookie: string, business = f.business, company = f.company, authorization?: string) {
  const headers: Record<string, string> = {
    'x-company-id': company,
    origin: 'http://admin.test',
  };
  if (authorization === undefined) headers.cookie = cookie;
  else headers.authorization = authorization;
  return f.h.app.inject({
    method: 'GET',
    url: `/v1/businesses/${business}/settings/identity-capability`,
    headers,
  });
}

function text(statusCode: number, body: string) {
  expect(statusCode).toBe(200);
  return body;
}

it('reports true for the owner', async () => {
  const res = await read(f.cookie);
  expect(identityCapability.parse(res.json())).toEqual({ can_manage_identity: true });
});

it('accepts an uppercase business id for a holder and returns the stored identity', async () => {
  await f.h.owner`INSERT INTO business_settings
      (company_id, business_id, official_name_ar, official_name_en)
    VALUES (${f.company}, ${f.business}, 'Alpha', 'Shop')
    ON CONFLICT (company_id, business_id) DO UPDATE
      SET official_name_ar = EXCLUDED.official_name_ar,
          official_name_en = EXCLUDED.official_name_en`;
  const business = f.business.toUpperCase();
  const capability = await read(f.cookie, business);
  expect(identityCapability.parse(capability.json())).toEqual({ can_manage_identity: true });
  const identity = await f.h.app.inject({
    method: 'GET',
    url: `/v1/businesses/${business}/settings/identity`,
    headers: { cookie: f.cookie, 'x-company-id': f.company, origin: 'http://admin.test' },
  });
  expect(identity.statusCode).toBe(200);
  expect(businessIdentity.parse(identity.json())).toEqual({
    official_name_ar: 'Alpha',
    official_name_en: 'Shop',
    logo_file_id: null,
  });
});

it('reports false for a member who does not hold the identity permission', async () => {
  const res = await read(f.managerCookie);
  deniedBody = text(res.statusCode, res.body);
  expect(identityCapability.parse(JSON.parse(deniedBody))).toEqual({ can_manage_identity: false });
});

it('reports the same false body for an unknown business and a foreign business', async () => {
  const [foreign] = await f.h.owner`SELECT id FROM businesses WHERE company_id = ${f.otherCompany}`;
  const unknown = await read(f.cookie, f.ids.newId());
  const other = await read(f.cookie, foreign?.['id'] as string);
  expect(text(unknown.statusCode, unknown.body)).toBe(deniedBody);
  expect(text(other.statusCode, other.body)).toBe(deniedBody);
});

it('reports the same false body for a device principal', async () => {
  const code = await f.h.send('POST', `/v1/branches/${f.branch}/devices/pairing-code`, {
    cookie: f.cookie,
    company: f.company,
  });
  expect(code.status).toBe(201);
  const registered = await f.h.app.inject({
    method: 'POST',
    url: '/v1/devices/register',
    payload: { pairing_code: code.body['code'], label: 'Synthetic identity capability' },
  });
  expect(registered.statusCode).toBe(201);
  const device = registered.json<{ company_id: string; device_id: string; claim_secret: string }>();
  const approved = await f.h.send(
    'POST',
    `/v1/branches/${f.branch}/devices/${device.device_id}/approve`,
    { cookie: f.cookie, company: f.company },
  );
  expect(approved.status).toBe(204);
  const claimed = await f.h.app.inject({
    method: 'POST',
    url: '/v1/devices/claim',
    payload: device,
  });
  expect(claimed.statusCode).toBe(200);
  const token = claimed.json<{ device_token: string }>().device_token;
  const res = await read(f.cookie, f.business, f.company, `Device ${token}`);
  expect(text(res.statusCode, res.body)).toBe(deniedBody);
});

it('reports true for a granted holder and the same false body when that grant is denied', async () => {
  await seedOverride(f, f.managerMember, {
    permission_code: 'manage:business-identity:business',
    scope_type: 'BUSINESS',
    scope_id: f.business,
  });
  const allowed = await read(f.managerCookie);
  expect(identityCapability.parse(allowed.json())).toEqual({ can_manage_identity: true });
  await seedOverride(f, f.managerMember, {
    permission_code: 'manage:business-identity:business',
    effect: 'DENY',
    scope_type: 'BUSINESS',
    scope_id: f.business,
  });
  const denied = await read(f.managerCookie);
  expect(text(denied.statusCode, denied.body)).toBe(deniedBody);
});

it('returns the capability contract for the owner without taking locks', async () => {
  const result = await f.db.withTenant(
    f.company,
    (tx) => readIdentityCapability(tx, f.company, f.userId, f.business, identityCapabilityAccess()),
    { userId: f.userId },
  );
  expect(identityCapability.parse(result)).toEqual({ can_manage_identity: true });
});

it('plans the business lookup without a sequential scan', async () => {
  await f.db.withTenant(f.company, async (tx) => {
    await tx.execute(sql`SET LOCAL enable_seqscan=off`);
    const [row] = await tx.execute<{ 'QUERY PLAN': { Plan: ExplainNode }[] }>(
      sql`EXPLAIN (ANALYZE, FORMAT JSON) ${identityCapabilityBusinessStatement(f.company, f.business)}`,
    );
    const nodes = planNodes(row?.['QUERY PLAN'][0]?.Plan);
    const scanned = nodes.filter(
      (node) => node['Relation Name'] === 'businesses' || node['Relation Name'] === 'companies',
    );
    expect(scanned.some((node) => node['Relation Name'] === 'businesses')).toBe(true);
    expect(scanned.every((node) => node['Node Type'] !== 'Seq Scan')).toBe(true);
  });
});

it('does not block while another transaction holds the company row FOR UPDATE', async () => {
  let release!: () => void;
  const released = new Promise<void>((done) => {
    release = done;
  });
  let held!: () => void;
  const holding = new Promise<void>((done) => {
    held = done;
  });
  const holder = f.db.withTenant(
    f.company,
    async (tx) => {
      await tx.execute(sql`SELECT id FROM companies WHERE id=${f.company} FOR UPDATE`);
      held();
      await released;
    },
    { userId: f.userId },
  );
  let timer: ReturnType<typeof setTimeout> | undefined;
  let holderError: unknown;
  const ended = holder.then(
    () => 'ended' as const,
    (error: unknown) => {
      holderError = error;
      return 'failed' as const;
    },
  );
  try {
    const gate = await Promise.race([holding.then(() => 'held' as const), ended]);
    if (gate !== 'held')
      throw holderError ?? new Error('company lock ended before the capability read');
    const response = await Promise.race([
      read(f.cookie),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error('CAPABILITY_BLOCKED_ON_COMPANY_LOCK')), 1_500);
      }),
    ]);
    expect(response.statusCode).toBe(200);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    release();
    await ended;
  }
});

interface ExplainNode {
  'Node Type': string;
  'Relation Name'?: string;
  Plans?: ExplainNode[];
}

function planNodes(node: ExplainNode | undefined): ExplainNode[] {
  return node ? [node, ...(node.Plans ?? []).flatMap(planNodes)] : [];
}
