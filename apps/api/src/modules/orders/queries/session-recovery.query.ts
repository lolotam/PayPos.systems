import { serviceSessionRecoveryCursor, serviceSessionRecoveryPage, type ServiceSessionRecoveryCursor,
  type ServiceSessionRecoveryOperation, type ServiceSessionRecoveryPage, type ServiceSessionRecoveryVisit } from '@pospay/contracts';
import type { TenantWrappers, Tx } from '@pospay/db';
import { sql, type SQL } from 'drizzle-orm';

export interface SessionRecoveryScope { companyId: string; userId: string; businessId: string; branchId: string }
export interface SessionRecoveryAccess {
  /** يثبت تبعية الفرع حتى تبقى زيارة قديمة مقروءة بعد إيقاف الفرع. */
  place(tx: Tx, scope: SessionRecoveryScope): Promise<boolean>;
  /** يعيد فحص التسجيل والميزة داخل معاملة كل صفحة. */
  record(tx: Tx, scope: SessionRecoveryScope, at: Date): Promise<'ALLOWED' | 'DENIED' | 'FEATURE_DISABLED'>;
}
export interface SessionRecoveryClock { /** لحظة الفحص المحقونة حتى تثبت الاختبارات البوابة. */ now(): Date }
export type SessionRecoveryKeyHash = (key: string) => string;
export interface SessionRecoveryLookup {
  scope: SessionRecoveryScope; operation: ServiceSessionRecoveryOperation; keyHash: string; at: Date;
  cursor: { at: string; id: string } | null;
}
export class SessionRecoveryReadError extends Error {
  constructor(readonly code: 'FORBIDDEN' | 'FEATURE_DISABLED' | 'VALIDATION_FAILED' | 'SESSION_RECOVERY_NOT_FOUND' | 'SESSION_RECOVERY_NOT_YET' | 'SESSION_RECOVERY_CLOSED',
    readonly details?: { reason: 'EXPIRED' | 'REVOKED' } | { opens_at: string }) { super(code); }
}
type RecoveryRow = {
  proof_id: string; issued_at: string; expires_at: string; opens_at: string; business_timezone: string; business_date: string;
  gate: 'OPEN' | 'REVOKED' | 'EXPIRED' | 'NOT_YET'; outcome: 'COMMITTED' | 'NOT_COMMITTED' | null;
  cursor_at: string | null; cursor_id: string | null; item: ServiceSessionRecoveryVisit | string | null;
};
const PAGE = 50;

function utc(expression: SQL): SQL {
  return sql`to_char((${expression}) AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;
}
function recoveryFeature(): SQL {
  // تعليق بلا تاريخ مفهوم لا يخفي النتيجة؛ الصب يتم فقط بعد تطابق الشكل.
  return sql`SELECT CASE WHEN marker ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T' THEN marker::timestamptz END AS started_at
    FROM (SELECT substring(obj_description('public.service_session_recoveries'::regclass) FROM 'recovery_feature_started_at=([^ ]+)') AS marker) parsed`;
}
function recoveryProof(input: SessionRecoveryLookup): SQL {
  const at = input.at.toISOString();
  return sql`SELECT r.id AS proof_id, ${utc(sql`r.issued_at`)} AS issued_at, ${utc(sql`r.expires_at`)} AS expires_at,
      ${utc(sql`r.last_seen_at + interval '24 hours'`)} AS opens_at, r.business_timezone,
      to_char(COALESCE(linked.business_date, r.business_date), 'YYYY-MM-DD') AS business_date,
      COALESCE(linked.business_date, r.business_date) AS list_date,
      CASE WHEN r.revoked_at IS NOT NULL THEN 'REVOKED' WHEN r.expires_at <= ${at}::timestamptz THEN 'EXPIRED'
        WHEN r.last_seen_at + interval '24 hours' > ${at}::timestamptz THEN 'NOT_YET' ELSE 'OPEN' END AS gate,
      CASE WHEN feature.started_at IS NOT NULL AND r.issued_at < feature.started_at + interval '48 hours' THEN NULL
        WHEN r.committed_at IS NOT NULL THEN 'COMMITTED' ELSE 'NOT_COMMITTED' END AS outcome
    FROM service_session_recoveries r CROSS JOIN feature
    LEFT JOIN service_sessions linked ON linked.company_id = r.company_id AND linked.id = r.session_id
    WHERE r.company_id = ${input.scope.companyId} AND r.company_id = app_company_id()
      AND r.user_id = ${input.scope.userId} AND r.user_id = app_user_id()
      AND r.business_id = ${input.scope.businessId} AND r.branch_id = ${input.scope.branchId}
      AND r.operation = ${input.operation} AND r.key_hash = ${input.keyHash}`;
}
function ownActiveLine(): SQL {
  return sql`l.company_id = s.company_id AND l.session_id = s.id AND l.status = 'ACTIVE' AND l.recorded_by = app_user_id()`;
}
function recoveryVisits(input: SessionRecoveryLookup): SQL {
  const cursor = input.cursor;
  const after = cursor === null ? sql`TRUE` : sql`(s.occurred_at, s.id) > (${cursor.at}::text::timestamptz, ${cursor.id}::uuid)`;
  // التاريخ والبوابة initplan ثابتان؛ المقارنة بعمود الـ CTE لا تفتح فهرس اليوم.
  return sql`SELECT ${utc(sql`page.occurred_at`)} AS cursor_at, page.id AS cursor_id, jsonb_build_object(
      'id', page.id, 'occurred_at', ${utc(sql`page.occurred_at`)}, 'customer_name', page.customer_name,
      'customer_phone_masked', page.customer_phone_masked, 'lines', lines.items) AS item
    FROM (
      SELECT s.company_id, s.id, s.occurred_at, s.customer_name, s.customer_phone_masked
      FROM service_sessions s
      WHERE s.company_id = ${input.scope.companyId} AND s.company_id = app_company_id() AND s.business_id = ${input.scope.businessId}
        AND s.branch_id = ${input.scope.branchId} AND s.business_date = (SELECT list_date FROM proof)
        AND (SELECT gate FROM proof) = 'OPEN' AND ${after}
        AND EXISTS (SELECT 1 FROM service_lines l WHERE ${ownActiveLine()})
      ORDER BY s.occurred_at ASC, s.id ASC LIMIT ${PAGE + 1}
    ) page JOIN LATERAL (
      SELECT jsonb_agg(jsonb_build_object('id', l.id, 'ordinal', l.ordinal, 'name_ar', l.name_ar, 'name_en', l.name_en) ORDER BY l.ordinal) AS items
      FROM service_lines l WHERE l.company_id = page.company_id AND l.session_id = page.id AND l.status = 'ACTIVE' AND l.recorded_by = app_user_id()
    ) lines ON true`;
}
// شاشة استرجاع المحاولة تقرأ إثبات المستدعية وزيارات يومها دون هاتف خام.
export function sessionRecoveryStatement(input: SessionRecoveryLookup): SQL {
  // القيمة المربوطة تطابق الفهرس الفريد؛ app_* يرفض غلافاً ضبط مستخدماً آخر.
  return sql`WITH feature AS (${recoveryFeature()}), proof AS (${recoveryProof(input)}),
      visits AS MATERIALIZED (${recoveryVisits(input)})
    SELECT proof.proof_id, proof.issued_at, proof.expires_at, proof.opens_at, proof.business_timezone, proof.business_date,
      proof.gate, proof.outcome, visits.cursor_at, visits.cursor_id, visits.item
    FROM proof LEFT JOIN visits ON true`;
}
function decode(scope: SessionRecoveryScope, operation: ServiceSessionRecoveryOperation, raw: string | undefined): ServiceSessionRecoveryCursor | null {
  if (raw === undefined) return null;
  try {
    const bytes = Buffer.from(raw, 'base64url');
    if (bytes.toString('base64url') !== raw) throw new Error('cursor');
    const cursor = serviceSessionRecoveryCursor.parse(JSON.parse(bytes.toString('utf8')));
    if (cursor.company === scope.companyId && cursor.business === scope.businessId && cursor.branch === scope.branchId && cursor.operation === operation) return cursor;
  } catch (error) { if (error instanceof SessionRecoveryReadError) throw error; }
  throw new SessionRecoveryReadError('VALIDATION_FAILED');
}
async function assertAccess(access: SessionRecoveryAccess, tx: Tx, scope: SessionRecoveryScope, at: Date): Promise<void> {
  if (!await access.place(tx, scope)) throw new SessionRecoveryReadError('FORBIDDEN');
  const record = await access.record(tx, scope, at);
  if (record !== 'ALLOWED') throw new SessionRecoveryReadError(record === 'DENIED' ? 'FORBIDDEN' : 'FEATURE_DISABLED');
}
function attemptOf(row: RecoveryRow): ServiceSessionRecoveryPage['attempt'] {
  return { business_date: row.business_date, business_timezone: row.business_timezone, issued_at: row.issued_at, expires_at: row.expires_at,
    ...(row.outcome === null ? {} : { outcome: row.outcome }) };
}
function nextCursor(scope: SessionRecoveryScope, operation: ServiceSessionRecoveryOperation, proof: string, row: RecoveryRow | undefined, more: boolean): string | null {
  if (!more || row?.cursor_at == null || row.cursor_id == null) return null;
  return Buffer.from(JSON.stringify({ v: 1, company: scope.companyId, business: scope.businessId, branch: scope.branchId,
    operation, proof, at: row.cursor_at, id: row.cursor_id })).toString('base64url');
}
function visitOf(item: RecoveryRow['item']): ServiceSessionRecoveryVisit | null {
  if (item === null) return null;
  return typeof item === 'string' ? JSON.parse(item) as ServiceSessionRecoveryVisit : item;
}
function pageOf(scope: SessionRecoveryScope, operation: ServiceSessionRecoveryOperation, rows: readonly RecoveryRow[], cursor: ServiceSessionRecoveryCursor | null): ServiceSessionRecoveryPage {
  const head = rows[0];
  if (head === undefined) throw new SessionRecoveryReadError('SESSION_RECOVERY_NOT_FOUND');
  if (cursor !== null && cursor.proof !== head.proof_id) throw new SessionRecoveryReadError('VALIDATION_FAILED');
  if (head.gate === 'REVOKED' || head.gate === 'EXPIRED') throw new SessionRecoveryReadError('SESSION_RECOVERY_CLOSED', { reason: head.gate });
  if (head.gate === 'NOT_YET') throw new SessionRecoveryReadError('SESSION_RECOVERY_NOT_YET', { opens_at: head.opens_at });
  if (head.gate !== 'OPEN') throw new SessionRecoveryReadError('SESSION_RECOVERY_NOT_FOUND');
  const filled = rows.flatMap((row) => { const item = visitOf(row.item); return item === null ? [] : [{ row, item }]; });
  const last = filled[Math.min(filled.length, PAGE) - 1];
  return serviceSessionRecoveryPage.parse({ items: filled.slice(0, PAGE).map((entry) => entry.item),
    next_cursor: nextCursor(scope, operation, head.proof_id, last?.row, filled.length > PAGE), attempt: attemptOf(head) });
}
export class SessionRecoveryQuery {
  constructor(private readonly db: TenantWrappers, private readonly access: SessionRecoveryAccess, private readonly clock: SessionRecoveryClock, private readonly hashKey: SessionRecoveryKeyHash) {}
  async execute(scope: SessionRecoveryScope, operation: ServiceSessionRecoveryOperation, key: string, cursorRaw?: string): Promise<ServiceSessionRecoveryPage> {
    const cursor = decode(scope, operation, cursorRaw);
    const at = this.clock.now();
    const statement = sessionRecoveryStatement({ scope, operation, keyHash: this.hashKey(key), at, cursor: cursor === null ? null : { at: cursor.at, id: cursor.id } });
    return this.db.withTenant(scope.companyId, async (tx) => {
      await assertAccess(this.access, tx, scope, at);
      return pageOf(scope, operation, await tx.execute<RecoveryRow>(statement), cursor);
    }, { userId: scope.userId });
  }
}
