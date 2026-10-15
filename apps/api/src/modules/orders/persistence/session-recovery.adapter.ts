import { createHash } from 'node:crypto';
import type { IdGenerator, TenantWrappers, Tx } from '@pospay/db';
import { sql } from 'drizzle-orm';
import { ApiError } from '../../../shared/errors.ts';
import { activeBusinessTimeZone } from '../../tenancy/index.ts';
import { resolveSessionRecorder } from '../domain/session-authority.ts';
import { SessionError } from '../domain/session-error.ts';
import { sessionTime, validateAppendWindow } from '../domain/session-time.ts';
import type { SessionRecoveryIssue, SessionRecoveryPort } from '../ports/session-recovery.port.ts';
import type { Clock } from '../ports/service-session-transactions.port.ts';
import { loadSession } from './session-records.ts';
import { sessionRecordAccess } from './session-record-access.adapter.ts';

interface ProofDates { businessDate: string; timezone: string; sessionId: string | null }

/** هاش المفتاح فقط؛ الصف لا يحتفظ بـ Idempotency-Key الخام. */
export function recoveryKeyHash(key: string): string {
  return createHash('sha256').update(key).digest('hex');
}

function refuse(error: unknown): never {
  const seen = new Set<unknown>();
  for (let current = error; typeof current === 'object' && current !== null && !seen.has(current); current = (current as { cause?: unknown }).cause) {
    seen.add(current);
    if (current instanceof SessionError) throw current;
  }
  throw new ApiError('SESSION_RECOVERY_UNAVAILABLE');
}

async function lockIssuedProof(tx: Tx, input: SessionRecoveryIssue): Promise<void> {
  // SELECT لا يقفل صفاً غير موجود، فيمرّ إلحاقان أولان معاً ويمدّ الثاني إثبات جلسة أخرى. القفل على الهوية يسلسل الإصدار قبل القراءة.
  const hash = recoveryKeyHash(input.key);
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(
    app_company_id()::text || ':recovery:' || ${input.userId}::uuid::text || ':' || ${input.businessId}::uuid::text
    || ':' || ${input.branchId}::uuid::text || ':' || ${input.operation} || ':' || ${hash}, 0))`);
}

async function loadProof(tx: Tx, input: SessionRecoveryIssue, hash: string): Promise<ProofDates | undefined> {
  const [row] = await tx.execute<{ business_date: string; business_timezone: string; session_id: string | null }>(sql`
    SELECT to_char(business_date,'YYYY-MM-DD') AS business_date, business_timezone, session_id
    FROM service_session_recoveries
    WHERE company_id = app_company_id() AND user_id = ${input.userId} AND business_id = ${input.businessId}
      AND branch_id = ${input.branchId} AND operation = ${input.operation} AND key_hash = ${hash}`);
  return row === undefined ? undefined : { businessDate: row.business_date, timezone: row.business_timezone, sessionId: row.session_id };
}

async function prepareIssue(tx: Tx, input: SessionRecoveryIssue, at: Date): Promise<ProofDates> {
  const timezone = await activeBusinessTimeZone(tx, input.companyId, input.businessId, input.branchId);
  if (timezone === null) throw new SessionError('FORBIDDEN');
  const access = await sessionRecordAccess(tx, input.companyId, input.userId, input.businessId, input.branchId).read(at);
  const existing = await loadProof(tx, input, recoveryKeyHash(input.key));
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

async function upsertProof(tx: Tx, input: SessionRecoveryIssue, id: string, at: Date, dates: ProofDates): Promise<void> {
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
export function createSessionRecovery(database: TenantWrappers, ids: IdGenerator, clock: Clock): SessionRecoveryPort {
  return { issue: async (input) => {
    const at = clock.now();
    try {
      await database.withTenant(input.companyId, async (tx) => {
        await lockIssuedProof(tx, input);
        await upsertProof(tx, input, ids.newId(), at, await prepareIssue(tx, input, at));
      }, { userId: input.userId });
    } catch (error) { refuse(error); }
  } };
}
