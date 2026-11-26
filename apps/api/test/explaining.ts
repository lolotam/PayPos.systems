import type { Database, TenantWrappers, Tx } from '@pospay/db';
import { sql, type SQL } from 'drizzle-orm';

/**
 * يغلّف معاملات القاعدة بـ EXPLAIN ANALYZE عشان اختبار خطة الاستعلام يقرا الخطة من
 * Postgres نفسه، مش من تخمين. الـplan بيتجمع في `plans` بالترتيب اللي اتنفذ بيه.
 *
 * @param database قاعدة البيانات
 * @param plans   المكان بتجمع فيه خطط الاستعلام
 * @returns wrappers بتنفذ EXPLAIN قبل كل استعلام وبتنفذ الاستعلام نفسه
 */
export function explaining(database: Database, plans: string[]): TenantWrappers {
  const explain = (tx: Tx): Tx =>
    new Proxy(tx, {
      get: (target, property, receiver) =>
        property === 'execute'
          ? async (query: SQL) => {
              const [row] = await target.execute<{ plan: unknown }>(
                sql`EXPLAIN (ANALYZE, FORMAT JSON) ${query}`,
              );
              plans.push(JSON.stringify(Object.values(row ?? {})[0]));
              return target.execute(query);
            }
          : Reflect.get(target, property, receiver),
    });
  return {
    withUser: (userId, fn) => database.withUser(userId, (tx) => fn(explain(tx))),
    withNewTenant: (userId, fn) => database.withNewTenant(userId, (tx, id) => fn(explain(tx), id)),
    withMember: (userId, companyId, fn) =>
      database.withMember(userId, companyId, (tx) => fn(explain(tx))),
    withTenant: (companyId, fn, options) =>
      database.withTenant(companyId, (tx) => fn(explain(tx)), options),
  };
}
