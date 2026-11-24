import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { assertEmailInventory } from './platform-email-inventory.ts';
import { assertNotificationsRole } from './platform-notifications-inventory.ts';
import { withDeadline, type Tx } from './with-tenant.ts';

/**
 * فشل تخزين مؤقت بقدره الطلب إنه يسببه في الاستعمال الطبيعي: مهلة قفل أو تنفيذ، اتصال واقطع، أو
 * نتيجة COMMIT مش متأكدة. الـ API بيرد 503 NOT_READY والمزود بيعيد، والصف اللي اتعهد بيفضل موجود
 * (CLAUDE.md §5: خطأ متايخ، مش Error خالص).
 */
export class PlatformStorageUnavailableError extends Error {
  constructor() {
    super('PLATFORM_STORAGE_UNAVAILABLE');
    this.name = 'PlatformStorageUnavailableError';
  }
}

// أكواد الأعطال المؤقتة اللي إعادة المحاولة معقولة فيها: مهلة القفل، إلغاء المهلة (statement/idle)،
// قعات الاتصال، والزحمة. ما فيش سر ولا SQL بينتزل معاهم.
const TRANSIENT_SQLSTATES = new Set([
  '55P03',
  '57014',
  '57P05',
  '53300',
  '08000',
  '08001',
  '08003',
  '08006',
  'ECONNRESET',
  'EPIPE',
  'ECONNREFUSED',
  'ETIMEDOUT',
  'CONNECTION_CLOSED',
  'CONNECTION_ENDED',
  'CONNECTION_DESTROYED',
]);

const isTransientStorage = (error: unknown): boolean => {
  const seen = new Set<object>();
  let current: unknown = error;
  while (typeof current === 'object' && current !== null && !seen.has(current)) {
    seen.add(current);
    const candidate = current as { code?: unknown; name?: unknown; cause?: unknown };
    if (typeof candidate.code === 'string' && TRANSIENT_SQLSTATES.has(candidate.code)) return true;
    if (candidate.name === 'TimeoutError' || candidate.name === 'CommitOutcomeUnknownError')
      return true;
    current = candidate.cause;
  }
  return false;
};

/** واجهة الاستقبال العامة للإيميل؛ مفيش وصول لبيانات الشركات ولا اتصال خام. */
export interface PlatformEmailDatabase {
  /** معاملة محدودة لعملية الاستقبال قبل الرد على المزود. */
  withGlobal<T>(work: (tx: Tx) => Promise<T>, timeoutMs?: number): Promise<T>;
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
    withGlobal: (work, timeoutMs = 200) =>
      withDeadline(Math.max(1, timeoutMs), (gate) =>
        db.transaction(async (tx) => {
          gate.onStart();
          await tx.execute(sql`SET TRANSACTION ISOLATION LEVEL READ COMMITTED`);
          await tx.execute(sql`SELECT set_config('statement_timeout',${`${Math.max(1, timeoutMs)}ms`},true),
        set_config('lock_timeout',${`${Math.max(1, timeoutMs)}ms`},true), set_config('idle_in_transaction_session_timeout',${`${Math.max(1, timeoutMs)}ms`},true)`);
          // فحص الاستعداد بيغطي الصلاحيات بالكامل؛ كل معاملة بتتأكد من دور الاتصال فقط.
          await assertNotificationsRole(tx);
          const result = await work(tx);
          gate.beforeCommit();
          return result;
        }),
      ).catch((error: unknown) => {
        if (error instanceof PlatformStorageUnavailableError) throw error;
        // مهلة القفل أو التنفيذ أو قطع الاتصال أو نتيجة COMMIT مش معروفة: 503 يخلي المزود يعيد،
        // والصف اللي اتعهد قبل الفشل بيفضل موجود والـ replay آمن بالبصمة.
        if (isTransientStorage(error)) throw new PlatformStorageUnavailableError();
        throw error;
      }),
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
