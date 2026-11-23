import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { assertEmailInventory } from './platform-email-inventory.ts';
import { assertNotificationsRole } from './platform-notifications-inventory.ts';
import { withDeadline, type Tx } from './with-tenant.ts';

/** واجهة الاستقبال العامة للإيميل؛ مفيش وصول لبيانات الشركات ولا اتصال خام. */
export interface PlatformEmailDatabase {
  /** معاملة محدودة لعملية الاستقبال قبل الرد على المزود. */
  withGlobal<T>(work: (tx: Tx) => Promise<T>): Promise<T>;
  /** يفشل الاستعداد عند تغيّر الدور أو الصلاحيات أو قيد رفع الحظر. */
  ping(): Promise<void>;
  /** يغلق الاتصال؛ الإيقاف القسري يصرف بدء التشغيل الفاشل دون انتظار مهلة الاتصال. */
  close(force?: boolean): Promise<void>;
}

/** ينشئ اتصالاً خاصاً بدور الاستقبال دون كشف العميل أو قيم الاتصال في الأخطاء. */
export function createPlatformEmailDatabase(options: {
  url: string;
  maxConnections?: number;
}): PlatformEmailDatabase {
  const client = openClient(options.url, options.maxConnections ?? 2);
  const db = drizzle(client);
  return {
    withGlobal: (work) =>
      withDeadline(200, (gate) =>
        db.transaction(async (tx) => {
          gate.onStart();
          await tx.execute(sql`SET TRANSACTION ISOLATION LEVEL READ COMMITTED`);
          await tx.execute(sql`SELECT set_config('statement_timeout','200ms',true),
        set_config('lock_timeout','200ms',true), set_config('idle_in_transaction_session_timeout','200ms',true)`);
          // فحص الاستعداد بيغطي الصلاحيات بالكامل؛ كل معاملة بتتأكد من دور الاتصال فقط.
          await assertNotificationsRole(tx);
          const result = await work(tx);
          gate.beforeCommit();
          return result;
        }),
      ),
    ping: () => assertEmailInventory(db),
    close: (force = false) => client.end({ timeout: force ? 0 : 5 }),
  };
}

function openClient(url: string, max: number) {
  try {
    if (!['postgres:', 'postgresql:'].includes(new URL(url).protocol))
      throw new Error('INVALID_PROTOCOL');
    return postgres(url, { max, onnotice: () => undefined, connect_timeout: 2 });
  } catch {
    throw new Error('PLATFORM_EMAIL_DATABASE_URL_INVALID');
  }
}
