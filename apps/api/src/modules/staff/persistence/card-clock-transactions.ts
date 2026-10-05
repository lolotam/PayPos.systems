import { createHash } from 'node:crypto';
import { runIdempotent, type IdGenerator, type TenantWrappers, type Tx } from '@pospay/db';
import { sql } from 'drizzle-orm';
import type { ClockResult } from '../domain/clock-attendance.ts';
import { AttendanceError } from '../domain/clock-attendance.ts';
import { cardCodeMatches, normalizeCardCode } from '../domain/employee-card.ts';
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
): CardClockTransactions {
  return {
    run: (scope, cardCode, sample, work) =>
      database.withTenant(
        scope.companyId,
        async (tx) => {
          const card = await findActiveCard(tx, scope, normalizeCardCode(cardCode));
          const state = await lockAttendanceState(tx, {
            companyId: scope.companyId,
            employeeId: card.employee_id,
          });
          const { context, at } = await lockedCardContext(
            tx,
            scope,
            card.employee_id,
            sample,
            state,
          );
          return work(buildTransaction(tx, scope, card.employee_id, context, ids), at);
        },
        { userId: scope.operatorId, timeoutMs: ATTENDANCE_TRANSACTION_TIMEOUT_MS },
      ),
  };
}

async function findActiveCard(tx: Tx, scope: CardClockScope, code: string) {
  // TODO(spec) CB-Q2: the SPEC lists card_code, so the raw code is stored for the scan lookup;
  // a keyed hash plus a display suffix needs its own ADR and migration.
  const [card] = await tx.execute<{ id: string; card_code: string; employee_id: string }>(sql`
    SELECT id,card_code,employee_id FROM employee_cards
    WHERE company_id=${scope.companyId} AND business_id=${scope.businessId} AND card_code=${code}
      AND revoked_at IS NULL FOR SHARE`);
  // الكارت الملغى والمجهول وكارت نشاط آخر كلها لا صف نشط، فالرد واحد.
  if (card === undefined || !cardCodeMatches(card.card_code, code))
    throw new AttendanceError('NOT_FOUND');
  return card;
}

function buildTransaction(
  tx: Tx,
  scope: CardClockScope,
  employeeId: string,
  context: CardClockContext,
  ids: IdGenerator,
): CardClockTransaction {
  return {
    context,
    idempotent: async (key, fingerprint, effect) => {
      const bound = createHash('sha256')
        .update(JSON.stringify([scope.companyId, scope.deviceId, scope.operatorId, fingerprint]))
        .digest('hex');
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
