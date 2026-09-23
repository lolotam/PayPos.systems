import type { Business, PageQuery } from '@pospay/contracts';
import type { TenantWrappers } from '@pospay/db';
import { sql } from 'drizzle-orm';

/** The cursor is not one this API issued. */
export class InvalidCursorError extends Error {
  override readonly name = 'InvalidCursorError';
}

interface Cursor {
  readonly at: string;
  readonly id: string;
}

const ISSUED_AT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?[+-]\d{2}:\d{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const encode = (cursor: Cursor): string =>
  Buffer.from(JSON.stringify(cursor)).toString('base64url');

function decode(value: string): Cursor {
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as Partial<Cursor>;
    // Only what this query issues: Postgres' own timestamptz text (microseconds kept) and a UUID. Anything else
    // would reach the ::timestamptz / ::uuid casts and fail as a 500 instead of a 400.
    if (
      typeof parsed.at === 'string' &&
      ISSUED_AT.test(parsed.at) &&
      !Number.isNaN(Date.parse(parsed.at)) &&
      typeof parsed.id === 'string' &&
      UUID.test(parsed.id)
    ) {
      return { at: parsed.at, id: parsed.id };
    }
  } catch {
    // falls through to the refusal below
  }
  throw new InvalidCursorError();
}

// Screen: admin › company › businesses. Newest first, keyset on (created_at, id) over
// businesses_company_id_created_at_idx; the row is already the Business contract's shape.
export async function listBusinesses(
  db: TenantWrappers,
  access: { companyId: string; userId: string },
  page: PageQuery,
): Promise<{ items: Business[]; next_cursor: string | null }> {
  const after = page.cursor === undefined ? undefined : decode(page.cursor);
  const rows = await db.withTenant(
    access.companyId,
    async (tx) =>
      Array.from(
        await tx.execute<Business>(sql`
          SELECT id, company_id, vertical_type, name_ar, name_en, currency, timezone, settings,
                 to_json(created_at) #>> '{}' AS created_at
          FROM businesses
          WHERE company_id = ${access.companyId}
            ${after === undefined ? sql`` : sql`AND (created_at, id) < (${after.at}::timestamptz, ${after.id}::uuid)`}
          ORDER BY created_at DESC, id DESC
          LIMIT ${page.limit + 1}`),
      ),
    { userId: access.userId },
  );
  const items = rows.slice(0, page.limit);
  const last = items.at(-1);
  return {
    items,
    next_cursor:
      rows.length > page.limit && last !== undefined
        ? encode({ at: last.created_at, id: last.id })
        : null,
  };
}
