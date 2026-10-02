import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { assertWhatsappInventory, assertWhatsappRole } from './platform-whatsapp-inventory.ts';
import { withDeadline, type Tx } from './with-tenant.ts';

/** واجهة الاستقبال العامة لا تمنح أي وصول لبيانات الشركات أو اتصال خام. */
export interface PlatformWhatsappDatabase {
  /** معاملة محدودة للتأثير المتزامن قبل الرد على STOP. */
  withGlobal<T>(work: (tx: Tx) => Promise<T>): Promise<T>;
  /** يفشل الاستعداد عند تغيّر الدور أو الصلاحيات أو قيد منع الاشتراك. */
  ping(): Promise<void>;
  /** يغلق الاتصال عند إيقاف الخدمة. */
  close(): Promise<void>;
}

/** ينشئ اتصالاً خاصاً بدور الاستقبال دون كشف العميل أو قيم الاتصال في الأخطاء. */
export function createPlatformWhatsappDatabase(options: {
  url: string;
  maxConnections?: number;
}): PlatformWhatsappDatabase {
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
          // فحص الاستعداد يغطي الصلاحيات بالكامل؛ كل معاملة تتأكد أيضاً من دور الاتصال الحالي.
          await assertWhatsappRole(tx);
          const result = await work(tx);
          gate.beforeCommit();
          return result;
        }),
      ),
    ping: () => assertWhatsappInventory(db),
    close: () => client.end({ timeout: 5 }),
  };
}

function openClient(url: string, max: number) {
  try {
    if (!['postgres:', 'postgresql:'].includes(new URL(url).protocol))
      throw new Error('INVALID_PROTOCOL');
    return postgres(url, { max, onnotice: () => undefined, connect_timeout: 2 });
  } catch {
    throw new Error('PLATFORM_WHATSAPP_DATABASE_URL_INVALID');
  }
}
