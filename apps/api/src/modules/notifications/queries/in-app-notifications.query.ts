import {
  id,
  timestamp,
  inAppNotificationQuery,
  inAppNotificationPage,
  type InAppNotification,
  type InAppNotificationQuery,
} from '@pospay/contracts';
import type { TenantWrappers } from '@pospay/db';
import { sql } from 'drizzle-orm';

export class InvalidInAppCursorError extends Error {}
interface Cursor {
  readonly at: string;
  readonly id: string;
}
export interface InboxAccess {
  readonly companyId: string;
  readonly userId: string;
}

function decode(value: string | undefined): Cursor | null {
  if (value === undefined) return null;
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as Partial<Cursor>;
    if (timestamp.safeParse(parsed.at).success && id.safeParse(parsed.id).success)
      return parsed as Cursor;
  } catch {
    /* Cursor contents never enter diagnostics. */
  }
  throw new InvalidInAppCursorError('NOTIFICATION_CURSOR_INVALID');
}

// شاشة جرس الإشعارات تعرض فقط الرسائل الموجهة للمستخدم الحالي بالشركة المختارة.
export function inAppNotificationsStatement(access: InboxAccess, page: InAppNotificationQuery) {
  const cursor = decode(page.cursor);
  return sql`SELECT id,company_id,business_id,branch_id,source_event_id,template_key,template_revision,
    locale,safe_parameters,to_json(created_at) #>> '{}' AS created_at,to_json(read_at) #>> '{}' AS read_at
    FROM in_app_notifications WHERE company_id = ${access.companyId} AND recipient_user_id = ${access.userId}
    ${cursor === null ? sql`` : sql`AND (created_at,id) < (${cursor.at}::timestamptz,${cursor.id}::uuid)`}
    ORDER BY in_app_notifications.created_at DESC NULLS LAST,in_app_notifications.id DESC NULLS LAST
    LIMIT ${page.limit + 1}`;
}

export async function listInAppNotifications(
  db: TenantWrappers,
  access: InboxAccess,
  query: InAppNotificationQuery,
) {
  const page = inAppNotificationQuery.parse(query);
  const statement = inAppNotificationsStatement(access, page);
  let rows: InAppNotification[];
  try {
    rows = await db.withTenant(
      access.companyId,
      async (tx) => Array.from(await tx.execute<InAppNotification>(statement)),
      { userId: access.userId },
    );
  } catch (error) {
    const code = (error as { cause?: { code?: string } }).cause?.code;
    if (page.cursor !== undefined && ['22007', '22008', '22P02'].includes(code ?? ''))
      throw new InvalidInAppCursorError('NOTIFICATION_CURSOR_INVALID');
    throw inboxUnavailable();
  }
  const items = rows.slice(0, page.limit);
  const last = items.at(-1);
  return inAppNotificationPage.parse({
    items,
    next_cursor:
      rows.length > page.limit && last !== undefined
        ? Buffer.from(JSON.stringify({ at: last.created_at, id: last.id })).toString('base64url')
        : null,
  });
}

function inboxUnavailable(): Error {
  // خطأ Drizzle الأصلي يحمل معاملات؛ لا يدخل النص أو cause إلى التشخيصات.
  return new Error('NOTIFICATION_INBOX_UNAVAILABLE');
}
