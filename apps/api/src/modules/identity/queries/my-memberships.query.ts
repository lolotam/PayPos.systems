import {
  myMembershipsResponse,
  type MyMembership,
  type MyMembershipsResponse,
  type WorkspaceCompanyNames,
} from '@pospay/contracts';
import type { TenantWrappers, Tx } from '@pospay/db';
import { sql } from 'drizzle-orm';

import type { WorkspaceNames, WorkspaceScope } from './my-workspaces.query.ts';

const SCOPES = ['COMPANY', 'BUSINESS', 'BRANCH'] as const;
type ScopeName = (typeof SCOPES)[number];

type MembershipRow = {
  readonly company_id: string;
  readonly id: string;
  readonly scope_type: string;
  readonly scope_id: string;
  readonly role_id: string;
  readonly role_owner_key: string;
};

interface OwnMembership {
  readonly id: string;
  readonly scope_type: ScopeName;
  readonly scope_id: string;
  readonly role_id: string;
  readonly role_owner_key: string;
}

type RoleRow = {
  readonly id: string;
  readonly owner_key: string;
  readonly code: string;
  readonly name_ar: string | null;
  readonly name_en: string;
  readonly role_is_system: boolean;
};

interface MembershipRead {
  readonly db: TenantWrappers;
  readonly names: WorkspaceNames;
  readonly userId: string;
  readonly companyId: string;
}

function isScope(value: string): value is ScopeName {
  return (SCOPES as readonly string[]).includes(value);
}

function inCompany(rows: readonly MembershipRow[], companyId: string): OwnMembership[] {
  const own: OwnMembership[] = [];
  for (const row of rows) {
    if (row.company_id !== companyId || !isScope(row.scope_type)) continue;
    own.push({
      id: row.id,
      scope_type: row.scope_type,
      scope_id: row.scope_id,
      role_id: row.role_id,
      role_owner_key: row.role_owner_key,
    });
  }
  return own;
}

async function readOwn(
  db: TenantWrappers,
  userId: string,
  companyId: string,
): Promise<OwnMembership[]> {
  return db.withUser(userId, async (tx) => {
    // حوار إلغاء السطر: عضويات المتصل النشطة في الشركة دي بس. دور الشركة مش ظاهر من withUser.
    const rows = await tx.execute<MembershipRow>(sql`
      SELECT company_id, id, scope_type, scope_id, role_id, role_owner_key
      FROM memberships
      WHERE user_id = ${userId}
        AND company_id = ${companyId}
        AND starts_at <= now()
        AND (ends_at IS NULL OR now() < ends_at)
      ORDER BY id`);
    return inCompany(Array.from(rows), companyId);
  });
}

async function readRoles(tx: Tx, rows: readonly OwnMembership[]): Promise<Map<string, RoleRow>> {
  const payload = JSON.stringify(
    rows.map((row) => ({ id: row.role_id, owner_key: row.role_owner_key })),
  );
  const found = await tx.execute<RoleRow>(sql`
    SELECT r.id, r.owner_key, r.code, r.name_ar, r.name_en,
           (r.owner_key = 'global')::boolean AS role_is_system
    FROM roles r
    JOIN jsonb_to_recordset(${payload}::jsonb) AS wanted(id uuid, owner_key text)
      ON r.id = wanted.id AND r.owner_key = wanted.owner_key`);
  return new Map(Array.from(found).map((role) => [`${role.id}:${role.owner_key}`, role]));
}

function scopeNames(
  tree: WorkspaceCompanyNames,
  scope: ScopeName,
  scopeId: string,
): { scope_name_ar: string | null; scope_name_en: string } | null {
  if (scope === 'COMPANY') {
    return tree.id === scopeId
      ? { scope_name_ar: tree.name_ar, scope_name_en: tree.name_en }
      : null;
  }
  const business = tree.businesses.find((entry) =>
    scope === 'BUSINESS'
      ? entry.id === scopeId
      : entry.branches.some((branch) => branch.id === scopeId),
  );
  if (business === undefined) return null;
  if (scope === 'BUSINESS') {
    return { scope_name_ar: business.name_ar, scope_name_en: business.name_en };
  }
  const branch = business.branches.find((entry) => entry.id === scopeId);
  return branch === undefined
    ? null
    : { scope_name_ar: branch.name_ar, scope_name_en: branch.name_en };
}

function membershipOf(
  row: OwnMembership,
  role: RoleRow,
  tree: WorkspaceCompanyNames,
): MyMembership | null {
  const scope = scopeNames(tree, row.scope_type, row.scope_id);
  if (scope === null) return null;
  return {
    id: row.id,
    role_code: role.code,
    role_is_system: role.role_is_system,
    role_name_ar: role.name_ar,
    role_name_en: role.name_en,
    scope_type: row.scope_type,
    scope_id: row.scope_id,
    ...scope,
  };
}

async function namedMemberships(
  read: MembershipRead,
  rows: readonly OwnMembership[],
): Promise<MyMembership[]> {
  const scopes: WorkspaceScope[] = rows.map((row) => ({
    scope: row.scope_type,
    scopeId: row.scope_id,
  }));
  return read.db.withTenant(
    read.companyId,
    async (tx) => {
      const described = await read.names.describe(tx, scopes);
      if (described === null) return [];
      const roles = await readRoles(tx, rows);
      const memberships: MyMembership[] = [];
      for (const row of rows) {
        const role = roles.get(`${row.role_id}:${row.role_owner_key}`);
        if (role === undefined) throw new Error('membership role is missing');
        const membership = membershipOf(row, role, described);
        if (membership !== null) memberships.push(membership);
      }
      return memberships;
    },
    { userId: read.userId },
  );
}

export async function myMemberships(
  db: TenantWrappers,
  names: WorkspaceNames,
  userId: string,
  companyId: string,
): Promise<MyMembershipsResponse> {
  const rows = await readOwn(db, userId, companyId);
  if (rows.length === 0) return { items: [] };
  const items = await namedMemberships({ db, names, userId, companyId }, rows);
  return myMembershipsResponse.parse({ items });
}
