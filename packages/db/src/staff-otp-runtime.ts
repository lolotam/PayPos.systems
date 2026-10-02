import { sql } from 'drizzle-orm';
import { boundedPostgres } from './bounded-postgres.ts';
import type { Tx } from './with-tenant.ts';

export interface OtpRuntime {
  warm(): Promise<void>;
  close(): Promise<void>;
  /** اتصال المعاملة لا يغادر الحزمة، ويغلق قبل إنهاء العمل الملغى. */
  run<T>(work: (tx: Tx) => Promise<T>, deadline?: Date): Promise<T>;
  /** يقفل الهوية نفسها التي يستعملها STOP، ثم يقرأ ساعة قاعدة البيانات. */
  lock(tx: Tx, hash: Uint8Array): Promise<Date>;
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
    run: async (work, deadline = new Date(Date.now() + 1000)) => {
      try {
        return await pool.run(async (tx) => {
          await tx.execute(sql`SET TRANSACTION ISOLATION LEVEL READ COMMITTED`);
          const remaining = deadline.getTime() - Date.now();
          const idle = `${Math.max(1, remaining)}ms`;
          const statement = `${Math.max(1, Math.min(500, remaining - 40))}ms`;
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
      const [row] = await tx.execute<{ now: Date }>(sql`SELECT clock_timestamp() AS now`);
      if (row === undefined) throw new Error('OTP_DATABASE_UNAVAILABLE');
      return new Date(row.now);
    },
    suppressed: async (tx, hash) => {
      const [row] = await tx.execute<{ blocked: boolean }>(sql`
        SELECT public.platform_whatsapp_is_suppressed(${Buffer.from(hash)}::bytea) AS blocked`);
      if (typeof row?.blocked !== 'boolean') throw new Error('OTP_SUPPRESSION_UNAVAILABLE');
      return row.blocked;
    },
  };
}

function operationFailure(operation: string, error: unknown): Error {
  const failure = databaseFailure(error);
  return Object.assign(new Error(`OTP_${operation}_UNAVAILABLE`), {
    code: `${operation}_${failure.message.slice('OTP_DATABASE_UNAVAILABLE_'.length)}`,
  });
}

function databaseFailure(error: unknown): Error {
  const diagnostic =
    error !== null && typeof error === 'object' && 'cause' in error ? error.cause : error;
  const bounded =
    diagnostic instanceof Error &&
    ['BOUNDED_DATABASE_UNAVAILABLE', 'BOUNDED_COMMIT_UNKNOWN', 'BOUNDED_CONNECT_TIMEOUT'].includes(
      diagnostic.message,
    )
      ? diagnostic.message
      : null;
  const code =
    diagnostic !== null &&
    typeof diagnostic === 'object' &&
    'code' in diagnostic &&
    typeof diagnostic.code === 'string' &&
    /^[A-Z0-9_]{1,32}$/.test(diagnostic.code)
      ? diagnostic.code
      : (bounded ?? 'OPERATION_FAILED');
  return Object.assign(new Error(`OTP_DATABASE_UNAVAILABLE_${code}`), { code });
}
