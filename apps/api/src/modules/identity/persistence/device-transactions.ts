import type { IdGenerator, TenantWrappers, Tx } from '@pospay/db';
import { sql, type SQL } from 'drizzle-orm';

import { transactionWriters } from '../../../shared/adapters/transaction-writers.ts';
import type {
  DeviceChange,
  DeviceRecord,
  DeviceScope,
  DeviceTransactions,
} from '../ports/devices.port.ts';

const COLUMNS: Record<keyof DeviceChange, string> = {
  status: 'status',
  claimHash: 'claim_hash',
  tokenHash: 'token_hash',
  tokenExpiresAt: 'token_expires_at',
  approvedBy: 'approved_by',
  approvedAt: 'approved_at',
  revokedBy: 'revoked_by',
  revokedAt: 'revoked_at',
  lastSeenAt: 'last_seen_at',
};

function scopeFor(tx: Tx, companyId: string, ids: IdGenerator): DeviceScope {
  return {
    companyId,
    ...transactionWriters(tx, ids),
    findForUpdate: async (deviceId) => {
      const [row] = await tx.execute<{
        id: string;
        branch_id: string;
        label: string;
        status: DeviceRecord['status'];
        claim_hash: string | null;
        token_hash: string | null;
        token_expires_at: string | null;
      }>(sql`
        SELECT id, branch_id, label, status, claim_hash, token_hash,
               to_json(token_expires_at) #>> '{}' AS token_expires_at
        FROM devices WHERE company_id = ${companyId} AND id = ${deviceId}
        FOR UPDATE`);
      return row === undefined
        ? null
        : {
            id: row.id,
            branchId: row.branch_id,
            label: row.label,
            status: row.status,
            claimHash: row.claim_hash,
            tokenHash: row.token_hash,
            tokenExpiresAt: row.token_expires_at === null ? null : new Date(row.token_expires_at),
          };
    },
    insertPending: async (device) => {
      await tx.execute(sql`
        INSERT INTO devices (company_id, id, branch_id, label, device_fingerprint, app_version, status, claim_hash)
        VALUES (${companyId}, ${device.id}, ${device.branchId}, ${device.label}, ${device.fingerprint},
                ${device.appVersion}, 'PENDING', ${device.claimHash})`);
    },
    update: async (deviceId, change) => {
      const sets: SQL[] = Object.entries(change).map(([key, value]) => {
        const column = sql.raw(COLUMNS[key as keyof DeviceChange]);
        return value instanceof Date
          ? sql`${column} = ${value.toISOString()}::timestamptz`
          : sql`${column} = ${value}`;
      });
      if (sets.length === 0) return;
      await tx.execute(sql`
        UPDATE devices SET ${sql.join(sets, sql`, `)}
        WHERE company_id = ${companyId} AND id = ${deviceId}`);
    },
  };
}

/**
 * @param db  the tenant wrappers
 * @param ids the UUID v7 generator for audit and outbox rows
 * @returns withTenant for the device's company around the device work
 */
export function createDeviceTransactions(db: TenantWrappers, ids: IdGenerator): DeviceTransactions {
  return {
    run: (companyId, userId, work) =>
      db.withTenant(
        companyId,
        (tx) => work(scopeFor(tx, companyId, ids)),
        userId === null ? {} : { userId },
      ),
  };
}
