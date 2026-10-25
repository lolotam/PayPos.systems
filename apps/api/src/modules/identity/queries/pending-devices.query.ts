import {
  pendingDevicesCursor,
  pendingDevicesResponse,
  type PendingDevicesCursor,
  type PendingDevicesQuery,
  type PendingDevicesResponse,
} from '@pospay/contracts';
import type { Tx } from '@pospay/db';
import { sql } from 'drizzle-orm';

/** المؤشر مش صالح للصفحة دي: مش مفكوك، أو متعمل لفرع تاني. */
export class PendingDevicesCursorError extends Error {
  constructor() {
    super('the pending devices cursor is not usable');
    this.name = 'PendingDevicesCursorError';
  }
}

type PendingDeviceRow = {
  readonly id: string;
  readonly label: string;
  readonly created_at: string;
};

const createdAt = sql`to_char(d.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;

const same = (left: string, right: string): boolean => left.toLowerCase() === right.toLowerCase();

function decodeCursor(
  companyId: string,
  branchId: string,
  query: PendingDevicesQuery,
): PendingDevicesCursor | null {
  if (query.cursor === undefined) return null;
  try {
    const bytes = Buffer.from(query.cursor, 'base64url');
    if (bytes.toString('base64url') !== query.cursor) throw new Error();
    const cursor = pendingDevicesCursor.parse(JSON.parse(bytes.toString('utf8')));
    if (same(cursor.company, companyId) && same(cursor.branch, branchId)) return cursor;
  } catch {
    // بيانات المؤشر لا تدخل التشخيصات.
  }
  throw new PendingDevicesCursorError();
}

export async function listPendingDevices(
  tx: Tx,
  companyId: string,
  branchId: string,
  query: PendingDevicesQuery,
): Promise<PendingDevicesResponse> {
  // شاشة موافقة الأجهزة في الأدمن وفحص iOS: أجهزة الفرع اللي مستنية الموافقة، الأحدث الأول.
  const cursor = decodeCursor(companyId, branchId, query);
  const before =
    cursor === null
      ? sql``
      : sql`AND (d.created_at, d.id) < (${cursor.at}::text::timestamptz, ${cursor.id}::uuid)`;
  const rows = await tx.execute<PendingDeviceRow>(sql`
    SELECT d.id, d.label, ${createdAt} AS created_at
    FROM devices d
    WHERE d.company_id = ${companyId} AND d.branch_id = ${branchId} AND d.status = 'PENDING' ${before}
    ORDER BY d.created_at DESC, d.id DESC
    LIMIT ${query.limit + 1}`);
  const items = rows.slice(0, query.limit).map((row) => ({
    id: row.id,
    label: row.label,
    created_at: row.created_at,
  }));
  const last = items.at(-1);
  return pendingDevicesResponse.parse({
    items,
    next_cursor:
      rows.length > query.limit && last !== undefined
        ? Buffer.from(
            JSON.stringify({ v: 1, company: companyId, branch: branchId, at: last.created_at, id: last.id }),
          ).toString('base64url')
        : null,
  });
}
