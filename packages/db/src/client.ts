import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import {
  createTenantWrappers,
  type IdGenerator,
  type TenantWrappers,
  type Terminate,
} from './with-tenant.ts';

/**
 * إعدادات الاتصال — الـ url لازم يبقى على pospay_app، مش الـ owner.
 */
export interface DatabaseOptions {
  readonly url: string;
  readonly ids: IdGenerator;
  readonly maxConnections?: number;
}

/**
 * اللي الـ app بتاخده من الداتابيز: الـ wrappers التلاتة و ping و close — مفيش client خام.
 */
export interface Database extends TenantWrappers {
  /** بيتأكد إن الداتابيز بترد (SELECT 1) — لـ /ready، ومبيقراش أي بيانات شركة. */
  ping(): Promise<void>;
  close(): Promise<void>;
}

/**
 * بيفتح pool على pospay_app ويرجّع الـ wrappers بس. الـ client الخام بيفضل جوه الـ closure،
 * فمفيش module يقدر يعمل query من غير ما يعدّي على withTenant أو withUser (CLAUDE.md §5).
 *
 * @param options الـ url ومولّد الـ ids وحجم الـ pool
 * @returns الـ wrappers التلاتة و ping و close
 */
export function createDatabase(options: DatabaseOptions): Database {
  const client = postgres(options.url, {
    max: options.maxConnections ?? 10,
    onnotice: () => undefined,
  });
  // A connection of its own, outside the pool, so a deadline can end a transaction even when every pooled
  // connection is busy. It ends a backend only while that backend is still in the same transaction
  // (same pid and start time) — never a connection already back in the pool and running other work. The
  // role may signal its own backends (PostgreSQL allows it for the same role), and nothing else.
  const watchdog = postgres(options.url, { max: 1, onnotice: () => undefined });
  const terminate: Terminate = async ({ pid, started }) => {
    await watchdog`
      SELECT pg_terminate_backend(pid) FROM pg_stat_activity
      WHERE pid = ${pid} AND xact_start = ${started}::timestamptz`;
  };
  return {
    ...createTenantWrappers(drizzle(client), options.ids, terminate),
    ping: async () => {
      await client`SELECT 1`;
    },
    // A bounded close: after 5 s postgres.js terminates the connections instead of waiting forever.
    close: async () => {
      await Promise.all([client.end({ timeout: 5 }), watchdog.end({ timeout: 5 })]);
    },
  };
}
