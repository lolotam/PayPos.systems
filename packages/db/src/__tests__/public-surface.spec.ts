import { describe, expect, it } from 'vitest';

import pkg from '../../package.json' with { type: 'json' };
import * as db from '../index.ts';

describe('@pospay/db public surface (CLAUDE.md §5 — no raw client)', () => {
  it('exports the factory and the transaction-scoped writers — every writer needs a Tx', () => {
    expect(Object.keys(db).sort()).toEqual([
      'FEATURE_FLAGS',
      'IdempotencyKeyBusyError',
      'IdempotencyKeyReusedError',
      'OWNER_ROLE_ID',
      'PERMISSIONS',
      'PLATFORM_ROLES',
      'PROVISIONAL_PLAN_ID',
      'SYSTEM_ROLES',
      'appendAuditLog',
      'appendOutboxEvent',
      'createAuthDatabase',
      'createDatabase',
      'createOutboxDispatcherDatabase',
      'grantPlatformPermission',
      'markEventConsumed',
      'revokePlatformPermission',
      'runIdempotent',
      'verticalTemplate',
    ]);
  });

  it('hands out the three wrappers, ping and close — nothing that can run a query outside them', () => {
    const database = db.createDatabase({
      url: 'postgres://nobody:unused@127.0.0.1:1/none',
      ids: { newId: () => '00000000-0000-7000-8000-000000000000' },
    });
    expect(Object.keys(database).sort()).toEqual([
      'close',
      'ping',
      'withNewTenant',
      'withTenant',
      'withUser',
    ]);
    for (const value of Object.values(database)) {
      expect(typeof value).toBe('function');
    }
  });

  it('exposes no deep import path into the package', () => {
    expect(Object.keys(pkg.exports)).toEqual(['.']);
  });
});
