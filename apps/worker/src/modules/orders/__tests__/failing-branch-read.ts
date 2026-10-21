import type { Database, Tx } from '@pospay/db';
import type { SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';

/**
 * يغلّف قاعدة التطبيق فتفشل قراءة مكان الفرع كأن الاتصال انقطع، وتمر بقية الجمل كما هي:
 * الخطأ العابر الذي يجب أن يتركه مستهلك الجرس لإعادة محاولة الـ outbox.
 *
 * @param db قاعدة pospay_app في الـ fixture
 * @returns القاعدة التي يعمل عليها الـ deliverer
 */
export function failingBranchRead(db: Pick<Database, 'withTenant'>): Pick<Database, 'withTenant'> {
  const dialect = new PgDialect();
  return {
    withTenant: (company, work, options) =>
      db.withTenant(
        company,
        (tx) =>
          work(
            new Proxy(tx, {
              get: (target, prop, receiver) =>
                prop === 'execute'
                  ? async (query: SQL) => {
                      if (dialect.sqlToQuery(query).sql.includes('AS branch_timezone'))
                        throw Object.assign(new Error('connection reset'), { code: '08006' });
                      return target.execute(query);
                    }
                  : Reflect.get(target, prop, receiver),
            }) as Tx,
          ),
        options,
      ),
  };
}
