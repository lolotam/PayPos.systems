import type { TenantWrappers, Tx } from '@pospay/db';
import type { SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { createAccessReader } from '../persistence/access-reader.ts';
import { AuthorizeRequest } from '../use-cases/authorize-request/authorize-request.ts';

export function measuredAuthorizer(db: TenantWrappers) {
  const trace = {
    active: 0,
    maximum: 0,
    events: [] as string[],
    tenants: [] as { companyId: string; userId: string | undefined; tx: Tx }[],
    reads: [] as { tx: Tx; sql: string }[],
  };
  const dialect = new PgDialect();
  async function measured<T>(name: string, run: () => Promise<T>): Promise<T> {
    trace.events.push(`${name}:enter`);
    trace.active += 1;
    trace.maximum = Math.max(trace.maximum, trace.active);
    try {
      return await run();
    } finally {
      trace.active -= 1;
      trace.events.push(`${name}:exit`);
    }
  }
  const wrappers: TenantWrappers = {
    withUser: (userId, fn) => measured('user', () => db.withUser(userId, fn)),
    withNewTenant: (userId, fn) => measured('new', () => db.withNewTenant(userId, fn)),
    withMember: (userId, companyId, fn) =>
      measured('member', () => db.withMember(userId, companyId, fn)),
    withTenant: (companyId, fn, options) =>
      measured('tenant', () =>
        db.withTenant(
          companyId,
          (tx) => {
            trace.tenants.push({ companyId, userId: options?.userId, tx });
            const recorded = new Proxy(tx, {
              get(target, property, receiver) {
                return property === 'execute'
                  ? (query: SQL) => {
                      trace.reads.push({ tx, sql: dialect.sqlToQuery(query).sql });
                      return target.execute(query);
                    }
                  : Reflect.get(target, property, receiver);
              },
            });
            return fn(recorded);
          },
          options,
        ),
      ),
  };
  return { authorizer: new AuthorizeRequest(createAccessReader(wrappers)), trace };
}
