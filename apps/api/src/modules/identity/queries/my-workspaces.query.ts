import type {
  MyWorkspacesResponse,
  WorkspaceCompany,
  WorkspaceCompanyNames,
} from '@pospay/contracts';
import type { TenantWrappers, Tx } from '@pospay/db';
import { sql } from 'drizzle-orm';

export interface WorkspaceScope {
  readonly scope: 'COMPANY' | 'BUSINESS' | 'BRANCH';
  readonly scopeId: string;
}

/** Names for one company, read inside the caller's withTenant transaction. Declared here so queries/ stays off ports/. */
export interface WorkspaceNames {
  describe(tx: Tx, scopes: readonly WorkspaceScope[]): Promise<WorkspaceCompanyNames | null>;
}

const WIDTH = { COMPANY: 2, BUSINESS: 1, BRANCH: 0 } as const;
type ScopeName = keyof typeof WIDTH;

interface Membership {
  readonly company_id: string;
  readonly id: string;
  readonly scope_type: ScopeName;
  readonly scope_id: string;
  readonly role_id: string;
  readonly role_owner_key: string;
  readonly starts_at: Date | string;
}

type MembershipRow = {
  readonly company_id: string;
  readonly id: string;
  readonly scope_type: string;
  readonly scope_id: string;
  readonly role_id: string;
  readonly role_owner_key: string;
  readonly starts_at: Date | string;
};

function isScope(value: string): value is ScopeName {
  return Object.hasOwn(WIDTH, value);
}

function isMembership(row: MembershipRow): row is Membership {
  return isScope(row.scope_type);
}

function instant(value: Date | string): number {
  return value instanceof Date ? value.getTime() : new Date(value).getTime();
}

// عند تساوي العرض: الأقدم starts_at، ثم أصغر id للعضوية.
function wider(current: Membership, candidate: Membership): Membership {
  if (WIDTH[candidate.scope_type] !== WIDTH[current.scope_type]) {
    return WIDTH[candidate.scope_type] > WIDTH[current.scope_type] ? candidate : current;
  }
  if (instant(candidate.starts_at) !== instant(current.starts_at)) {
    return instant(candidate.starts_at) < instant(current.starts_at) ? candidate : current;
  }
  return candidate.id < current.id ? candidate : current;
}

function byCompany(rows: readonly Membership[]): Membership[][] {
  const groups = new Map<string, Membership[]>();
  for (const row of rows) {
    const group = groups.get(row.company_id);
    if (group === undefined) groups.set(row.company_id, [row]);
    else group.push(row);
  }
  return [...groups.values()];
}

function byNameThenId(a: WorkspaceCompany, b: WorkspaceCompany): number {
  if (a.name_en < b.name_en) return -1;
  if (a.name_en > b.name_en) return 1;
  if (a.id < b.id) return -1;
  if (a.id > b.id) return 1;
  return 0;
}

async function readMemberships(db: TenantWrappers, userId: string): Promise<Membership[]> {
  return db.withUser(userId, async (tx) => {
    // Screen: admin › tenant selector. Active now: started, and not yet ended.
    const rows = await tx.execute<MembershipRow>(sql`
      SELECT company_id, id, scope_type, scope_id, role_id, role_owner_key, starts_at
      FROM memberships
      WHERE user_id = ${userId}
        AND starts_at <= now()
        AND (ends_at IS NULL OR now() < ends_at)
      ORDER BY company_id, id`);
    return Array.from(rows).filter(isMembership);
  });
}

async function roleCode(tx: Tx, roleId: string, ownerKey: string): Promise<string> {
  // Read inside withTenant: a company-owned role is hidden from withUser.
  const [row] = Array.from(
    await tx.execute<{ code: string }>(sql`
      SELECT code FROM roles WHERE id = ${roleId} AND owner_key = ${ownerKey}`),
  );
  if (row === undefined) throw new Error('membership role is missing');
  return row.code;
}

async function oneCompany(
  db: TenantWrappers,
  names: WorkspaceNames,
  userId: string,
  rows: readonly Membership[],
): Promise<WorkspaceCompany | null> {
  const winner = rows.reduce(wider);
  return db.withTenant(
    winner.company_id,
    async (tx) => {
      const described = await names.describe(
        tx,
        rows.map((row) => ({ scope: row.scope_type, scopeId: row.scope_id })),
      );
      if (described === null) return null;
      return {
        ...described,
        role_code: await roleCode(tx, winner.role_id, winner.role_owner_key),
        scope: winner.scope_type,
      };
    },
    { userId },
  );
}

export async function myWorkspaces(
  db: TenantWrappers,
  names: WorkspaceNames,
  userId: string,
): Promise<MyWorkspacesResponse> {
  const companies: WorkspaceCompany[] = [];
  for (const group of byCompany(await readMemberships(db, userId))) {
    const company = await oneCompany(db, names, userId, group);
    if (company !== null) companies.push(company);
  }
  companies.sort(byNameThenId);
  return { companies };
}
