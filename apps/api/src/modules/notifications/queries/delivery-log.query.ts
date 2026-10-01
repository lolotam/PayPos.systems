import {
  deliveryLogQuery,
  id,
  timestamp,
  type DeliveryLogItem,
  type DeliveryLogQuery,
} from '@pospay/contracts';
import type { TenantWrappers } from '@pospay/db';
import { sql } from 'drizzle-orm';

export interface LogGrant {
  readonly permission: string;
  readonly effect: 'ALLOW' | 'DENY';
  readonly scopeType: string;
  readonly scopeId: string | null;
}
export interface LogAccess {
  readonly companyId: string;
  readonly userId: string;
  readonly grants: readonly LogGrant[];
}
export interface LogScope {
  readonly businessId?: string;
  readonly branchId?: string;
}
export class InvalidNotificationCursorError extends Error {
  override readonly name = 'InvalidNotificationCursorError';
}
interface Cursor {
  readonly at: string;
  readonly id: string;
}

function decode(cursor: string | undefined): Cursor | null {
  if (cursor === undefined) return null;
  try {
    const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as Partial<Cursor>;
    if (timestamp.safeParse(parsed.at).success && id.safeParse(parsed.id).success)
      return parsed as Cursor;
  } catch {
    /* Refuse without echoing untrusted cursor data. */
  }
  throw new InvalidNotificationCursorError('NOTIFICATION_CURSOR_INVALID');
}

function filter(access: LogAccess, scope: LogScope, cursor: Cursor | null) {
  return sql`a.company_id = ${access.companyId}
    ${scope.businessId === undefined ? sql`` : sql`AND a.business_id = ${scope.businessId}`}
    ${scope.branchId === undefined ? sql`` : sql`AND a.branch_id = ${scope.branchId}`}
    ${cursor === null ? sql`` : sql`AND (a.created_at, a.id) < (${cursor.at}::timestamptz, ${cursor.id}::uuid)`}
    AND (${grantFilter(access, 'ALLOW')}) AND NOT (${grantFilter(access, 'DENY')})`;
}

function grantFilter(access: LogAccess, effect: 'ALLOW' | 'DENY') {
  const grants = access.grants.filter(
    (g) => g.permission === 'view:notifications:business' && g.effect === effect,
  );
  if (grants.some((g) => g.scopeType === 'COMPANY' && g.scopeId === access.companyId))
    return sql`TRUE`;
  const scopes = grants.filter(
    (g) => g.scopeId !== null && ['BUSINESS', 'BRANCH'].includes(g.scopeType),
  );
  return scopes.length === 0
    ? sql`FALSE`
    : sql.join(
        scopes.map((g) =>
          g.scopeType === 'BUSINESS'
            ? sql`a.business_id = ${g.scopeId}::uuid`
            : sql`a.branch_id = ${g.scopeId}::uuid`,
        ),
        sql` OR `,
      );
}

// Screen: owner/manager delivery log. Only retained diagnostics are projected; destination, hash and parameters never leave SQL.
export function deliveryLogStatement(access: LogAccess, scope: LogScope, page: DeliveryLogQuery) {
  return sql`SELECT a.id, a.company_id, a.business_id, a.branch_id, a.source_event_id, a.channel,
    a.template_key, a.template_revision, a.locale, a.phone_last3, a.status,
    to_json(a.authorized_at) #>> '{}' AS authorized_at, to_json(a.send_deadline) #>> '{}' AS send_deadline,
    to_json(a.sending_at) #>> '{}' AS sending_at, to_json(a.finished_at) #>> '{}' AS finished_at,
    a.provider_message_id, a.failure_code, a.outcome_known, to_json(a.created_at) #>> '{}' AS created_at,
    to_json(a.updated_at) #>> '{}' AS updated_at
    FROM notification_attempts a WHERE ${filter(access, scope, decode(page.cursor))}
    ORDER BY a.created_at DESC NULLS LAST, a.id DESC NULLS LAST LIMIT ${page.limit + 1}`;
}

export async function deliveryLogQueryResult(
  db: TenantWrappers,
  access: LogAccess,
  scope: LogScope,
  query: DeliveryLogQuery,
): Promise<{ items: DeliveryLogItem[]; next_cursor: string | null }> {
  const page = deliveryLogQuery.parse(query);
  const statement = deliveryLogStatement(access, scope, page);
  let rows: DeliveryLogItem[];
  try {
    rows = await db.withTenant(
      access.companyId,
      async (tx) => Array.from(await tx.execute<DeliveryLogItem>(statement)),
      { userId: access.userId },
    );
  } catch (error) {
    const code = (error as { cause?: { code?: unknown } }).cause?.code;
    if (page.cursor !== undefined && ['22007', '22008', '22P02'].includes(String(code)))
      throw new InvalidNotificationCursorError('NOTIFICATION_CURSOR_INVALID');
    throw queryUnavailable(code);
  }
  const items = rows.slice(0, page.limit);
  const last = items.at(-1);
  return {
    items,
    next_cursor:
      rows.length > page.limit && last !== undefined
        ? Buffer.from(JSON.stringify({ at: last.created_at, id: last.id })).toString('base64url')
        : null,
  };
}

function queryUnavailable(code: unknown): Error {
  // A raw Drizzle cause contains bound phone/parameter values; keep only SQLSTATE (ADR-0018 §3).
  return Object.assign(new Error('NOTIFICATION_LOG_UNAVAILABLE'), {
    code: typeof code === 'string' && /^[0-9A-Z]{5}$/.test(code) ? code : undefined,
  });
}
