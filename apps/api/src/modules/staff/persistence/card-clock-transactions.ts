import { runIdempotent, type IdGenerator, type TenantWrappers, type Tx } from '@pospay/db';
import { sql } from 'drizzle-orm';
import { fenceOperatorSession } from '../../identity/index.ts';
import type { ClockResult } from '../domain/clock-attendance.ts';
import type {
  CardClockContext,
  CardClockScope,
  CardClockTransaction,
  CardClockTransactions,
} from '../ports/clock-by-card.port.ts';
import { lockAttendanceState, lockedCardContext } from './attendance-context.adapter.ts';
import { persistAttendanceMovement } from './attendance-writes.ts';
import { ATTENDANCE_TRANSACTION_TIMEOUT_MS } from './attendance-transactions.ts';
import type { EmployeeCardHash } from './employee-card-hash.ts';

// الكارت الجديد يفتح نفس معاملة الحضور وحدها؛ الكود الخام لا يخرج من الذاكرة.
export function createCardClockTransactions(
  database: TenantWrappers,
  ids: IdGenerator,
  hash: EmployeeCardHash,
  sessions: Parameters<typeof fenceOperatorSession>[1],
): CardClockTransactions {
  return {
    completed: (scope, idem) => readCompletedClock(database, hash, scope, idem),
    run: (scope, cardCode, sample, work) =>
      database.withTenant(
        scope.companyId,
        async (tx) => {
          const codeHash = hash(scope.companyId, cardCode);
          const card = await findActiveCard(tx, scope, codeHash);
          const employeeId = card?.employee_id ?? '00000000-0000-0000-0000-000000000000';
          const state = await lockAttendanceState(
            tx,
            {
              companyId: scope.companyId,
              employeeId,
            },
            false,
          );
          const { context, at } = await lockedCardContext(
            tx,
            scope,
            employeeId,
            sample,
            state,
            () => confirmCard(tx, scope, card?.id ?? null, codeHash),
          );
          const result = await work(
            buildTransaction(tx, scope, employeeId, context, ids, hash, sessions),
            at,
          );
          // آخر خطوة قبل الإتمام، فكتابة بعد الفحص الأول لا تتجاوز موعد الجلسة.
          await fenceOperatorSession(tx, sessions, operatorProof(scope));
          return result;
        },
        { userId: scope.operatorId, timeoutMs: ATTENDANCE_TRANSACTION_TIMEOUT_MS },
      ),
  };
}

async function findActiveCard(tx: Tx, scope: CardClockScope, codeHash: string) {
  // قراءة بلا قفل لتحديد الموظف فقط؛ State أول قفل، والكارت يُثبت بعد أقفال الهوية والموظف.
  const [card] = await tx.execute<{ id: string; employee_id: string }>(sql`
    SELECT id,employee_id FROM employee_cards
    WHERE company_id=${scope.companyId} AND business_id=${scope.businessId} AND card_code_hash=${codeHash}
      AND revoked_at IS NULL`);
  return card;
}

async function confirmCard(tx: Tx, scope: CardClockScope, cardId: string | null, codeHash: string) {
  const rows = await tx.execute(sql`SELECT id FROM employee_cards
    WHERE company_id=${scope.companyId} AND business_id=${scope.businessId} AND id=${cardId}::uuid
      AND card_code_hash=${codeHash} AND revoked_at IS NULL FOR SHARE`);
  return rows.length === 1;
}

function operatorProof(scope: CardClockScope) {
  return {
    sessionId: scope.sessionId,
    userId: scope.operatorId,
    deadline: scope.sessionDeadline,
    device: {
      companyId: scope.companyId,
      businessId: scope.businessId,
      branchId: scope.branchId,
      deviceId: scope.deviceId,
    },
  };
}

function buildTransaction(
  tx: Tx,
  scope: CardClockScope,
  employeeId: string,
  context: CardClockContext,
  ids: IdGenerator,
  hash: EmployeeCardHash,
  sessions: Parameters<typeof fenceOperatorSession>[1],
): CardClockTransaction {
  return {
    context,
    confirmOperator: () => fenceOperatorSession(tx, sessions, operatorProof(scope)),
    idempotent: async (key, fingerprint, effect) => {
      const bound = boundClockFingerprint(hash, scope, fingerprint);
      const result = await runIdempotent(
        tx,
        { scope: 'COMPANY', operation: 'clock-by-card', key, fingerprint: bound },
        async () => ({ status: 200, body: await effect() }),
      );
      return result.body as ClockResult;
    },
    persist: (write) =>
      persistAttendanceMovement(
        tx,
        {
          companyId: scope.companyId,
          businessId: scope.businessId,
          employeeId,
          branchId: scope.branchId,
          source: 'BARCODE',
          binding: null,
          qrWindow: null,
          deviceId: scope.deviceId,
          operatorId: scope.operatorId,
          location: context.location,
          installationId: null,
          timezone: context.timezone,
          resolvedByUserId: scope.operatorId,
        },
        write,
        ids,
      ),
  };
}

// البصمة المخزّنة تربط الجهاز والعامل؛ قراءة الإعادة تستخدم نفس الربط حتى لا يُعاد رد جهاز آخر.
function boundClockFingerprint(
  hash: EmployeeCardHash,
  scope: CardClockScope,
  fingerprint: string,
): string {
  return hash(
    scope.companyId,
    JSON.stringify([
      'clock-command:v1',
      scope.companyId,
      scope.deviceId,
      scope.operatorId,
      fingerprint,
    ]),
    'clock',
  );
}

// قراءة فقط: إعادة المحاولة عند سقف المسح تجد الرد المكتمل دون claim جديد.
async function readCompletedClock(
  database: TenantWrappers,
  hash: EmployeeCardHash,
  scope: CardClockScope,
  idem: { readonly key: string; readonly fingerprint: string },
): Promise<ClockResult | null> {
  const fingerprint = boundClockFingerprint(hash, scope, idem.fingerprint);
  return database.withTenant(
    scope.companyId,
    async (tx) => {
      const [row] = await tx.execute<{ body: unknown }>(sql`
        SELECT response_body AS body FROM idempotency_keys
        WHERE scope_type='COMPANY' AND scope_id=app_company_id()
          AND operation='clock-by-card' AND key=${idem.key}
          AND request_fingerprint=${fingerprint} AND response_status=200`);
      return row === undefined ? null : storedClock(row.body);
    },
    { userId: scope.operatorId },
  );
}

function storedClock(body: unknown): ClockResult | null {
  if (!isClockResult(body)) return null;
  return body;
}

function isClockResult(body: unknown): body is ClockResult {
  if (body === null || typeof body !== 'object') return false;
  const row = body as Record<string, unknown>;
  const exceptions = row['exceptions'];
  return (
    typeof row['session_id'] === 'string' &&
    (row['operation'] === 'CLOCK_IN' || row['operation'] === 'CLOCK_OUT') &&
    typeof row['working_date'] === 'string' &&
    typeof row['accepted_at'] === 'string' &&
    Array.isArray(exceptions) &&
    exceptions.every(clockException) &&
    typeof row['late_minutes'] === 'number' &&
    (row['missed_session_id'] === null || typeof row['missed_session_id'] === 'string')
  );
}

function clockException(value: unknown): value is 'NONE' | 'OUT_OF_RANGE' {
  return value === 'NONE' || value === 'OUT_OF_RANGE';
}
