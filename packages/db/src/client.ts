import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import { createTenantWrappers, type IdGenerator, type TenantWrappers } from './with-tenant.ts';

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
  return {
    ...createTenantWrappers(drizzle(client), options.ids),
    ping: async () => {
      await client`SELECT 1`;
    },
    close: () => client.end(),
  };
}
