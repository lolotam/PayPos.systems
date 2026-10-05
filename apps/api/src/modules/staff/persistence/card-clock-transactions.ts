import { runIdempotent, type IdGenerator, type TenantWrappers, type Tx } from '@pospay/db';
import { sql } from 'drizzle-orm';
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

// الكارت الجديد يفتح نفس معاملة الحضور وحدها؛ الكود الخام لا يخرج من الذاكرة.
export function createCardClockTransactions(
  database: TenantWrappers,
  ids: IdGenerator,
  hash: (companyId: string, code: string) => string,
): CardClockTransactions {
  return {
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
          return work(buildTransaction(tx, scope, employeeId, context, ids, hash), at);
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

function buildTransaction(
  tx: Tx,
  scope: CardClockScope,
  employeeId: string,
  context: CardClockContext,
  ids: IdGenerator,
  hash: (companyId: string, code: string) => string,
): CardClockTransaction {
  return {
    context,
    idempotent: async (key, fingerprint, effect) => {
      const bound = hash(
        scope.companyId,
        JSON.stringify([
          'clock-command:v1',
          scope.companyId,
          scope.deviceId,
          scope.operatorId,
          fingerprint,
        ]),
      );
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
