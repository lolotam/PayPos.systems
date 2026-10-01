import { notificationUnreadCount } from '@pospay/contracts';
import type { TenantWrappers } from '@pospay/db';
import { sql } from 'drizzle-orm';

import type { InboxAccess } from './in-app-notifications.query.ts';

// شارة الجرس تحسب غير المقروء للمستخدم نفسه، وليس كل إشعارات الشركة.
export function unreadCountStatement(access: InboxAccess) {
  return sql`SELECT count(*)::integer AS count FROM in_app_notifications
    WHERE company_id = ${access.companyId} AND recipient_user_id = ${access.userId} AND read_at IS NULL`;
}

export async function unreadCount(db: TenantWrappers, access: InboxAccess) {
  const rows = await db.withTenant(
    access.companyId,
    (tx) => tx.execute(unreadCountStatement(access)),
    { userId: access.userId },
  );
  return notificationUnreadCount.parse(rows[0]);
}
