import { sql } from 'drizzle-orm';
import { boundedPostgres } from './bounded-postgres.ts';
import type { Tx } from './with-tenant.ts';

export interface OtpRuntime {
  warm(): Promise<void>;
  close(): Promise<void>;
  /** اتصال المعاملة لا يغادر الحزمة، ويغلق قبل إنهاء العمل الملغى. */
  run<T>(
    work: (tx: Tx) => Promise<T>,
    deadline?: Date,
    limits?: { statementMs: number },
  ): Promise<T>;
  /** يقفل الهوية نفسها التي يستعملها STOP، ثم يقرأ ساعة قاعدة البيانات. */
  lock(tx: Tx, hash: Uint8Array): Promise<Date>;
  /** ساعة جديدة بعد اكتمال الأقفال؛ الانتظار لا يمد صلاحية الاعتماد. */
  now(tx: Tx): Promise<Date>;
  /** لقطة statement جديدة بعد القفل تمنع تفويت STOP المعتمد. */
  suppressed(tx: Tx, hash: Uint8Array): Promise<boolean>;
}

export function createOtpRuntime(
  url: string,
  phoneLockKey: (hash: Uint8Array) => bigint,
): OtpRuntime {
  const pool = boundedPostgres(url);
  return {
    warm: pool.warm,
    close: pool.close,
    now: databaseNow,
    run: async (work, deadline = new Date(Date.now() + 1000), limits = { statementMs: 500 }) => {
      try {
        return await pool.run(async (tx) => {
          await tx.execute(sql`SET TRANSACTION ISOLATION LEVEL READ COMMITTED`);
          const remaining = deadline.getTime() - Date.now();
          const idle = `${Math.max(1, remaining)}ms`;
          const statement = `${Math.max(1, Math.min(limits.statementMs, remaining - 40))}ms`;
          const [role] = await tx.execute<{
            valid: boolean;
          }>(sql`SELECT set_config('statement_timeout',${statement},true),
            set_config('lock_timeout',${statement},true),set_config('idle_in_transaction_session_timeout',${idle},true),
            current_user='pospay_auth' AND NOT rolsuper AND NOT rolbypassrls AS valid FROM pg_roles WHERE rolname=current_user`);
          if (role?.valid !== true) throw new Error('OTP_DATABASE_UNAVAILABLE');
          return work(tx);
        }, deadline);
      } catch (error) {
        throw databaseFailure(error);
      }
    },
    lock: async (tx, hash) => {
      try {
        await tx.execute(
          sql`SELECT pg_advisory_xact_lock(${phoneLockKey(hash).toString()}::bigint)`,
        );
      } catch (error) {
        throw operationFailure('PHONE_LOCK', error);
      }
      return databaseNow(tx);
    },
    suppressed: async (tx, hash) => {
      const [row] = await tx.execute<{ blocked: boolean }>(sql`
        SELECT public.platform_whatsapp_is_suppressed(${Buffer.from(hash)}::bytea) AS blocked`);
      if (typeof row?.blocked !== 'boolean') throw new Error('OTP_SUPPRESSION_UNAVAILABLE');
      return row.blocked;
    },
  };
}

async function databaseNow(tx: Tx): Promise<Date> {
  const [row] = await tx.execute<{ now: Date }>(sql`SELECT clock_timestamp() AS now`);
  if (row === undefined) throw new Error('OTP_DATABASE_UNAVAILABLE');
  return new Date(row.now);
}

/** أكواد المجمع المحدود — فشل عابر يُعاد، لا خطأ حقيقي. */
const BOUNDED_CODES = [
  'BOUNDED_DATABASE_UNAVAILABLE',
  'BOUNDED_COMMIT_UNKNOWN',
  'BOUNDED_CONNECT_TIMEOUT',
];
/** كود خام من PostgreSQL أو postgres.js: رمز كبير محدود الطول. */
const RAW_CODE = /^[A-Z0-9_]{1,32}$/;
/** كود سكّنه هذا الـ runtime: بادئة العملية تطيله فيتسع للرمز الأطول. */
const MINTED_CODE = /^[A-Z0-9_]{1,48}$/;
/** رسائل هذا الـ runtime — بها يُعرف الكود الذي سكّناه نحن فلا يُشتق من جديد. */
const MINTED_MESSAGES = ['OTP_DATABASE_UNAVAILABLE_', 'OTP_PHONE_LOCK_UNAVAILABLE'];

function operationFailure(operation: string, error: unknown): Error {
  const failure = databaseFailure(error);
  return Object.assign(new Error(`OTP_${operation}_UNAVAILABLE`), {
    code: `${operation}_${failure.code}`,
  });
}

function databaseFailure(error: unknown): Error & { readonly code: string } {
  const diagnostic =
    error !== null && typeof error === 'object' && 'cause' in error ? error.cause : error;
  const bounded =
    diagnostic instanceof Error && BOUNDED_CODES.includes(diagnostic.message)
      ? diagnostic.message
      : null;
  // كود سكّناه نحن: يُحفظ كما هو. إعادة اشتقاقه تقطع بادئة العملية وتُفقد تصنيفه.
  const minted =
    diagnostic instanceof Error &&
    MINTED_MESSAGES.some((prefix) => diagnostic.message.startsWith(prefix));
  const raw =
    diagnostic !== null &&
    typeof diagnostic === 'object' &&
    'code' in diagnostic &&
    typeof diagnostic.code === 'string'
      ? diagnostic.code
      : null;
  const code =
    raw !== null && (minted ? MINTED_CODE.test(raw) : RAW_CODE.test(raw))
      ? raw
      : (bounded ?? 'OPERATION_FAILED');
  return Object.assign(new Error(`OTP_DATABASE_UNAVAILABLE_${code}`), { code });
}
