import type { TenantWrappers } from '@pospay/db';
import { sql } from 'drizzle-orm';

import type { InAppRepository } from '../ports/in-app.repository.ts';

export function createInAppRepository(db: TenantWrappers): InAppRepository {
  return {
    markRead: async (actor, id, now) => {
      await db.withTenant(
        actor.companyId,
        (tx) =>
          tx.execute(sql`UPDATE in_app_notifications
        SET read_at = ${now.toISOString()} WHERE company_id = ${actor.companyId}
        AND recipient_user_id = ${actor.userId} AND id = ${id} AND read_at IS NULL`),
        { userId: actor.userId },
      );
    },
    markAllRead: async (actor, now) => {
      await db.withTenant(
        actor.companyId,
        (tx) =>
          tx.execute(sql`UPDATE in_app_notifications
        SET read_at = ${now.toISOString()} WHERE company_id = ${actor.companyId}
        AND recipient_user_id = ${actor.userId} AND read_at IS NULL`),
        { userId: actor.userId },
      );
    },
  };
}
