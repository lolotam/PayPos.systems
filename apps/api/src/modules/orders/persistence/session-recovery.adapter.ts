import type { IdGenerator, TenantWrappers, Tx } from '@pospay/db';
import { sql } from 'drizzle-orm';
import { activeBusinessTimeZone } from '../../tenancy/index.ts';
import { resolveSessionRecorder } from '../domain/session-authority.ts';
import { SessionError } from '../domain/session-error.ts';
import { sessionTime, validateAppendWindow } from '../domain/session-time.ts';
import type { SessionRecoveryIssue, SessionRecoveryPort } from '../ports/session-recovery.port.ts';
import type { Clock } from '../ports/service-session-transactions.port.ts';
import { loadSession } from './session-records.ts';
import { sessionRecordAccess } from './session-record-access.adapter.ts';
import { loadProof, recoveryKeyHash, refuseRecoveryIssue, type RecoveryProofDates } from './session-recovery-proof.ts';

export { recoveryKeyHash };

// lock_timeout بيتعاد مع كل قفل، فالقفل الاستشاري ثم قفل الصف ممكن يطولوا أكتر من الحد.
// timeoutMs موعد واحد من انتظار الاتصال لحد الـ commit.
const RECOVERY_ISSUE_DEADLINE_MS = 10_000;

async function lockIssuedProof(tx: Tx, input: SessionRecoveryIssue): Promise<void> {
  // SELECT لا يقفل صفاً غير موجود، فيمرّ إلحاقان أولان معاً ويمدّ الثاني إثبات جلسة أخرى. القفل على الهوية يسلسل الإصدار قبل القراءة.
  const hash = recoveryKeyHash(input.key);
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(
    app_company_id()::text || ':recovery:' || ${input.userId}::uuid::text || ':' || ${input.businessId}::uuid::text
    || ':' || ${input.branchId}::uuid::text || ':' || ${input.operation} || ':' || ${hash}, 0))`);
}

async function prepareIssue(tx: Tx, input: SessionRecoveryIssue, at: Date): Promise<RecoveryProofDates> {
  const timezone = await activeBusinessTimeZone(tx, input.companyId, input.businessId, input.branchId);
  if (timezone === null) throw new SessionError('FORBIDDEN');
  const access = await sessionRecordAccess(tx, input.companyId, input.userId, input.businessId, input.branchId).read(at);
  const existing = await loadProof(tx, input);
  if (input.operation === 'append-service-session-lines') {
    const record = await loadSession(tx, input.companyId, input.businessId, input.branchId, input.sessionId);
    if (record === null) throw new SessionError('FORBIDDEN');
    resolveSessionRecorder(access, input.recorderMembershipId, record.recorded_by, input.userId);
    // نفس المفتاح على جلسة أخرى يبقي الإثبات مربوطاً بالأولى بعد تراجع الكتابة.
    if (existing !== undefined && existing.sessionId !== input.sessionId) throw new SessionError('IDEMPOTENCY_KEY_REUSED');
    if (existing === undefined) validateAppendWindow(record.business_date, at, record.business_timezone);
    return existing ?? { businessDate: record.business_date, timezone: record.business_timezone, sessionId: record.id };
  }
  resolveSessionRecorder(access, input.recorderMembershipId, undefined, input.userId);
  if (existing !== undefined) return existing;
  const time = sessionTime(input.occurredAt, at, timezone);
  return { businessDate: time.business_date, timezone, sessionId: null };
}

async function upsertProof(tx: Tx, input: SessionRecoveryIssue, id: string, at: Date, dates: RecoveryProofDates): Promise<void> {
  const hash = recoveryKeyHash(input.key);
  const stamp = at.toISOString();
  // ختم أقدم لا يرجّع last_seen_at لأن نافذة القراءة تُفتح منه؛ الحي فقط يُمدَّد والمنتهي أو الملغى يبقى مغلقاً.
  await tx.execute(sql`
    INSERT INTO service_session_recoveries (
      company_id, id, business_id, branch_id, user_id, operation, key_hash,
      business_date, business_timezone, session_id, issued_at, last_seen_at, expires_at)
    VALUES (${input.companyId}, ${id}, ${input.businessId}, ${input.branchId}, ${input.userId}, ${input.operation}, ${hash},
      ${dates.businessDate}, ${dates.timezone}, ${dates.sessionId}, ${stamp}::timestamptz, ${stamp}::timestamptz,
      ${stamp}::timestamptz + interval '72 hours')
    ON CONFLICT (company_id, user_id, business_id, branch_id, operation, key_hash)
    DO UPDATE SET last_seen_at = greatest(service_session_recoveries.last_seen_at, ${stamp}::timestamptz),
      expires_at = least(greatest(service_session_recoveries.expires_at, ${stamp}::timestamptz + interval '72 hours'),
        service_session_recoveries.issued_at + interval '168 hours')
    WHERE service_session_recoveries.revoked_at IS NULL AND service_session_recoveries.expires_at > ${stamp}::timestamptz`);
}

/** يصدر الإثبات في معاملة تخصه قبل أي أثر مالي. */
export function createSessionRecovery(
  database: TenantWrappers,
  ids: IdGenerator,
  clock: Clock,
  options?: { readonly issueTimeoutMs?: number },
): SessionRecoveryPort {
  const issueTimeoutMs = options?.issueTimeoutMs ?? RECOVERY_ISSUE_DEADLINE_MS;
  return { issue: async (input) => {
    const at = clock.now();
    try {
      await database.withTenant(input.companyId, async (tx) => {
        await lockIssuedProof(tx, input);
        await upsertProof(tx, input, ids.newId(), at, await prepareIssue(tx, input, at));
      }, { userId: input.userId, timeoutMs: issueTimeoutMs });
    } catch (error) { refuseRecoveryIssue(error); }
  } };
}
