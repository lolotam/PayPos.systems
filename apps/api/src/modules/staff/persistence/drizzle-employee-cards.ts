import {
  appendAuditLog,
  runIdempotent,
  type IdGenerator,
  type TenantWrappers,
  type Tx,
} from '@pospay/db';
import { sql } from 'drizzle-orm';

import { EmployeeCardError, cardDisplaySuffix } from '../domain/employee-card.ts';
import type { Clock } from '../../../shared/ports/clock.port.ts';
import type {
  EmployeeCardRecord,
  EmployeeCardScope,
  EmployeeCardsPort,
} from '../ports/employee-cards.port.ts';

/** قرار إدارة الموظفين الذي يحتاجه الإصدار والإلغاء تحت القفل. */
interface CardManageAccess {
  lock(
    tx: Tx,
    companyId: string,
    userId: string,
    businessId: string,
  ): Promise<{ manage: boolean; featureEnabled: boolean }>;
}

// الإصدار يستبدل النشط السابق؛ الكود الخام يبقى في باراميتر واحد ولا يدخل التدقيق أو الرد.
export function createEmployeeCards(
  database: TenantWrappers,
  ids: IdGenerator,
  clock: Clock,
  access: CardManageAccess,
  hash: (companyId: string, code: string) => string,
): EmployeeCardsPort {
  return {
    issue: (scope, cardCode, idem) =>
      database.withTenant(
        scope.companyId,
        async (tx) => {
          await assertManage(tx, access, scope);
          const at = clock.now();
          const bound = boundFingerprint(scope, 'issue', idem.fingerprint, hash);
          const result = await runIdempotent(
            tx,
            {
              scope: 'COMPANY',
              operation: 'issue-employee-card',
              key: idem.key,
              fingerprint: bound,
            },
            async () => ({
              status: 200,
              body: await issueCard(tx, scope, cardCode, at, ids, hash),
            }),
          );
          return result.body as EmployeeCardRecord;
        },
        { userId: scope.operatorId },
      ),
    revoke: (scope, cardId, idem) =>
      database.withTenant(
        scope.companyId,
        async (tx) => {
          await assertManage(tx, access, scope);
          const at = clock.now();
          const bound = boundFingerprint(scope, 'revoke', idem.fingerprint, hash);
          const result = await runIdempotent(
            tx,
            {
              scope: 'COMPANY',
              operation: 'revoke-employee-card',
              key: idem.key,
              fingerprint: bound,
            },
            async () => ({ status: 200, body: await revokeCard(tx, scope, cardId, at, ids) }),
          );
          return result.body as EmployeeCardRecord;
        },
        { userId: scope.operatorId },
      ),
  };
}

async function assertManage(tx: Tx, access: CardManageAccess, scope: EmployeeCardScope) {
  const decision = await access.lock(tx, scope.companyId, scope.operatorId, scope.businessId);
  if (!decision.manage) throw new EmployeeCardError('FORBIDDEN');
  if (!decision.featureEnabled) throw new EmployeeCardError('FEATURE_DISABLED');
}

function boundFingerprint(
  scope: EmployeeCardScope,
  operation: string,
  fingerprint: string,
  hash: (companyId: string, code: string) => string,
) {
  return hash(
    scope.companyId,
    JSON.stringify([
      'card-command:v1',
      scope.companyId,
      scope.businessId,
      scope.employeeId,
      scope.operatorId,
      operation,
      fingerprint,
    ]),
  );
}

async function issueCard(
  tx: Tx,
  scope: EmployeeCardScope,
  cardCode: string,
  at: Date,
  ids: IdGenerator,
  hash: (companyId: string, code: string) => string,
): Promise<EmployeeCardRecord> {
  const [employee] = await tx.execute<{ id: string }>(sql`
    SELECT id FROM employees WHERE company_id=${scope.companyId} AND business_id=${scope.businessId}
      AND id=${scope.employeeId} AND deleted_at IS NULL FOR UPDATE`);
  if (employee === undefined) throw new EmployeeCardError('NOT_FOUND');
  const active = await tx.execute<{ id: string }>(sql`
    SELECT id FROM employee_cards WHERE company_id=${scope.companyId} AND employee_id=${scope.employeeId}
      AND revoked_at IS NULL FOR UPDATE`);
  const codeHash = hash(scope.companyId, cardCode);
  const suffix = cardDisplaySuffix(cardCode);
  const [duplicate] = await tx.execute<{ id: string }>(sql`
    SELECT id FROM employee_cards WHERE company_id=${scope.companyId} AND card_code_hash=${codeHash}
      AND revoked_at IS NULL AND employee_id<>${scope.employeeId} LIMIT 1`);
  if (duplicate !== undefined) throw new EmployeeCardError('EMPLOYEE_CARD_CODE_IN_USE');
  for (const card of active) await revokeRow(tx, scope, card.id, at, ids);
  const id = ids.newId();
  try {
    await tx.execute(sql`INSERT INTO employee_cards(company_id,id,business_id,employee_id,card_code_hash,card_code_suffix,issued_at,issued_by)
      VALUES(${scope.companyId},${id},${scope.businessId},${scope.employeeId},${codeHash},${suffix},${at.toISOString()},${scope.operatorId})`);
  } catch (error) {
    // الفهرس الجزئي هو الحرس النهائي في سباق إصدار بنفس الكود.
    if (uniqueViolation(error)) throw new EmployeeCardError('EMPLOYEE_CARD_CODE_IN_USE');
    throw error;
  }
  await appendAuditLog(tx, ids.newId(), {
    entity: 'employee_card',
    entityId: id,
    action: 'issued',
    after: { employee_id: scope.employeeId },
  });
  return record(id, scope.employeeId, suffix, at, null);
}

async function revokeCard(
  tx: Tx,
  scope: EmployeeCardScope,
  cardId: string,
  at: Date,
  ids: IdGenerator,
): Promise<EmployeeCardRecord> {
  const [card] = await tx.execute<{ card_code_suffix: string; issued_at: Date }>(sql`
    SELECT card_code_suffix,issued_at FROM employee_cards WHERE company_id=${scope.companyId} AND business_id=${scope.businessId}
      AND employee_id=${scope.employeeId} AND id=${cardId} AND revoked_at IS NULL FOR UPDATE`);
  if (card === undefined) throw new EmployeeCardError('NOT_FOUND');
  await revokeRow(tx, scope, cardId, at, ids);
  return record(cardId, scope.employeeId, card.card_code_suffix, new Date(card.issued_at), at);
}

async function revokeRow(
  tx: Tx,
  scope: EmployeeCardScope,
  cardId: string,
  at: Date,
  ids: IdGenerator,
) {
  await tx.execute(sql`UPDATE employee_cards SET revoked_at=${at.toISOString()},revoked_by=${scope.operatorId}
    WHERE company_id=${scope.companyId} AND id=${cardId} AND revoked_at IS NULL`);
  await appendAuditLog(tx, ids.newId(), {
    entity: 'employee_card',
    entityId: cardId,
    action: 'revoked',
    after: { employee_id: scope.employeeId },
  });
}

function record(
  id: string,
  employeeId: string,
  cardCode: string,
  issuedAt: Date,
  revokedAt: Date | null,
): EmployeeCardRecord {
  return {
    id,
    employeeId,
    cardCodeSuffix: cardCode,
    issuedAt: issuedAt.toISOString(),
    revokedAt: revokedAt === null ? null : revokedAt.toISOString(),
  };
}

function uniqueViolation(error: unknown): boolean {
  if (error === null || typeof error !== 'object') return false;
  const cause = error as { code?: string; cause?: unknown };
  return cause.code === '23505' || (cause.cause !== undefined && uniqueViolation(cause.cause));
}
