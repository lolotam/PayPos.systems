import { sql } from 'drizzle-orm';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import { account, session, twoFactor, user, verification } from '../schema/identity-auth.ts';

const identitySchema = { user, session, account, verification, twoFactor };

/**
 * جداول الهوية العامة بأسماء الـ models بتاعة Better Auth — الـ drizzle adapter محتاجها كده بالظبط.
 */
export type IdentitySchema = typeof identitySchema;

/**
 * الـ facade بتاع packages/auth (ADR-0003 §2.1): client على pospay_auth والـ schema بتاع جداول الهوية بس.
 * ده الاستثناء الوحيد اللي بيطلّع client من packages/db، والـ role نفسه ملوش أي grant غير على الجداول دي.
 */
export interface AuthDatabase {
  readonly db: PostgresJsDatabase<IdentitySchema>;
  readonly schema: IdentitySchema;
  /** بيتأكد إن الداتابيز بترد وإن الاتصال بـ pospay_auth بالظبط — عند التشغيل ولـ /ready. */
  ping(): Promise<void>;
  close(): Promise<void>;
}

/**
 * بيفتح pool على pospay_auth لـ Better Auth. أي package تاني ممنوع يستورده (no-restricted-imports)؛
 * و ping بيرفض أي role غير pospay_auth، فـ URL غلط مبيشتغلش بصلاحيات مش بتاعته.
 *
 * @param options الـ url (لازم يبقى pospay_auth) وحجم الـ pool
 * @param options.url            connection string على pospay_auth
 * @param options.maxConnections حجم الـ pool
 * @returns الـ client والـ schema و ping و close
 */
export function createAuthDatabase(options: {
  url: string;
  maxConnections?: number;
}): AuthDatabase {
  const client = postgres(options.url, {
    max: options.maxConnections ?? 5,
    onnotice: () => undefined,
  });
  const db = drizzle(client, { schema: identitySchema });
  return {
    db,
    schema: identitySchema,
    ping: async () => {
      const [row] = await db.execute<{ role: string; privileged: boolean }>(sql`
        SELECT current_user AS role,
               (SELECT rolsuper OR rolbypassrls FROM pg_roles WHERE rolname = current_user) AS privileged`);
      if (row?.role !== 'pospay_auth' || row.privileged !== false) {
        throw new Error('AUTH_DATABASE_URL must connect as pospay_auth');
      }
    },
    close: () => client.end({ timeout: 5 }),
  };
}
