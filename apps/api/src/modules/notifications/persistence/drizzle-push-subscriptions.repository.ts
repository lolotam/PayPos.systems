import type { TenantWrappers, Tx } from '@pospay/db';
import { sql } from 'drizzle-orm';

import type {
  LivePushSubscription,
  PushSubscriptionStore,
  PushSubscriptionTransactions,
  PushSubscriptionWrite,
} from '../ports/push-subscriptions.port.ts';

type Row = {
  id: string;
  user_id: string;
  installation_hash: string;
  endpoint_hash: string;
  created_at: Date;
};

const COLUMNS = sql`id,user_id,encode(installation_hash,'hex') AS installation_hash,
  encode(endpoint_hash,'hex') AS endpoint_hash,created_at`;

const bytes = (hex: string): Buffer => Buffer.from(hex, 'hex');

const toLive = (row: Row): LivePushSubscription => ({
  id: row.id,
  userId: row.user_id,
  installationHash: row.installation_hash,
  endpointHash: row.endpoint_hash,
  createdAt: new Date(row.created_at),
});

function storeFor(tx: Tx, companyId: string, ownerId: string): PushSubscriptionStore {
  return {
    lockUsers: async (userIds) => {
      for (const userId of [...new Set(userIds)].sort())
        await tx.execute(
          sql`SELECT pg_advisory_xact_lock(hashtextextended(${companyId + ':' + userId},0))`,
        );
    },
    findCallerLive: async (userId) => {
      const rows = await tx.execute<Row>(
        sql`SELECT ${COLUMNS} FROM push_subscriptions
          WHERE company_id=${companyId} AND user_id=${userId} AND revoked_at IS NULL`,
      );
      return rows.map(toLive);
    },
    findLiveByEndpoint: async (endpointHash) => {
      const rows = await tx.execute<Row>(
        sql`SELECT ${COLUMNS} FROM push_subscriptions
          WHERE company_id=${companyId} AND endpoint_hash=${bytes(endpointHash)} AND revoked_at IS NULL`,
      );
      return rows.map(toLive);
    },
    revoke: async (id, reason, now) => {
      await tx.execute(sql`UPDATE push_subscriptions SET revoked_at=${now.toISOString()},
        revoked_reason=${reason},endpoint=NULL,p256dh=NULL,auth=NULL,delivery_token=NULL,
        generation=generation+1,updated_at=${now.toISOString()}
        WHERE company_id=${companyId} AND id=${id} AND revoked_at IS NULL`);
    },
    upsert: async (row) => {
      await tx.execute(upsertStatement(companyId, ownerId, row));
    },
    revokeByInstallation: async (userId, installationHash, reason, now) => {
      await tx.execute(sql`UPDATE push_subscriptions SET revoked_at=${now.toISOString()},
        revoked_reason=${reason},endpoint=NULL,p256dh=NULL,auth=NULL,delivery_token=NULL,
        generation=generation+1,updated_at=${now.toISOString()}
        WHERE company_id=${companyId} AND user_id=${userId}
          AND installation_hash=${bytes(installationHash)} AND revoked_at IS NULL`);
    },
  };
}

// العدّاد بيتزوّد بس لما الوجهة أو رمز التسليم يتغيّروا أو الصف يكون متسحوب؛ التحديث العادي بيخليّه زي ما هو.
function upsertStatement(companyId: string, userId: string, row: PushSubscriptionWrite) {
  const at = row.now.toISOString();
  return sql`INSERT INTO push_subscriptions(company_id,id,user_id,installation_hash,endpoint,p256dh,auth,
      endpoint_hash,delivery_token,generation,locale,vapid_key_id,created_at,last_seen_at,updated_at)
    VALUES(${companyId},${row.id},${userId},${bytes(row.installationHash)},${row.endpoint},
      ${row.p256dh},${row.auth},${bytes(row.endpointHash)},${row.deliveryToken},1,${row.locale},
      ${row.vapidKeyId},${at},${at},${at})
    ON CONFLICT (company_id,user_id,installation_hash) DO UPDATE SET
      endpoint=EXCLUDED.endpoint,p256dh=EXCLUDED.p256dh,auth=EXCLUDED.auth,
      endpoint_hash=EXCLUDED.endpoint_hash,delivery_token=EXCLUDED.delivery_token,locale=EXCLUDED.locale,
      vapid_key_id=EXCLUDED.vapid_key_id,last_seen_at=EXCLUDED.last_seen_at,updated_at=EXCLUDED.updated_at,
      revoked_at=NULL,revoked_reason=NULL,
      generation=CASE WHEN push_subscriptions.endpoint_hash IS DISTINCT FROM EXCLUDED.endpoint_hash
          OR push_subscriptions.delivery_token IS DISTINCT FROM EXCLUDED.delivery_token
          OR push_subscriptions.revoked_at IS NOT NULL
        THEN push_subscriptions.generation+1 ELSE push_subscriptions.generation END`;
}

/**
 * @param db الـ tenant wrappers
 * @returns معاملة اشتراكات الدفع للشركة الواحدة
 */
export function createPushSubscriptionTransactions(
  db: TenantWrappers,
): PushSubscriptionTransactions {
  return {
    run: (target, work) =>
      db.withTenant(target.companyId, (tx) => work(storeFor(tx, target.companyId, target.userId)), {
        userId: target.userId,
      }),
  };
}
