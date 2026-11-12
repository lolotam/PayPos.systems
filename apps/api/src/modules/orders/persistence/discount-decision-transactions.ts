import {
  IdempotencyKeyReusedError,
  appendAuditLogs,
  appendOutboxEvent,
  runIdempotent,
  type IdGenerator,
  type TenantWrappers,
  type Tx,
} from '@pospay/db';
import { discountApprovedByPerformer } from '@pospay/contracts';
import { DiscountDecisionError } from '../domain/discount-decision-error.ts';
import { SessionError } from '../domain/session-error.ts';
import type {
  DiscountDecisionTransaction,
  DiscountDecisionTransactions,
} from '../ports/discount-decision.port.ts';
import type { EditorNamePort } from '../ports/line-edit.port.ts';
import type { SessionWriteContext } from '../ports/service-session-transactions.port.ts';
import type { DiscountApprovalAccessPort } from '../ports/discount-decision.port.ts';
import type { DiscountLimitPort, PerformerCheckPort } from '../ports/session-readers.port.ts';
import {
  decideDiscountProposals,
  lockDiscountDecisions,
  peekDiscountDecisions,
} from './discount-decision-writes.ts';
import { cleanSessionWrite } from './session-recovery-proof.ts';

const DECISION_OPERATION = 'decide-discount-proposals';

export interface DiscountDecisionReaders {
  access: DiscountApprovalAccessPort;
  discount: DiscountLimitPort;
  approverName: EditorNamePort;
  performers: PerformerCheckPort;
}

export function createDiscountDecisionTransactions(
  database: TenantWrappers,
  ids: IdGenerator,
  bind: (tx: Tx, context: SessionWriteContext) => DiscountDecisionReaders,
): DiscountDecisionTransactions {
  return {
    run: async (context, work) => {
      try {
        return await database.withTenant(
          context.companyId,
          async (tx) => work(assemble(tx, context, ids, bind)),
          { userId: context.userId },
        );
      } catch (error) {
        if (error instanceof DiscountDecisionError) throw error;
        if (error instanceof IdempotencyKeyReusedError) throw new SessionError('IDEMPOTENCY_KEY_REUSED');
        cleanSessionWrite(error);
      }
    },
  };
}

function assemble(
  tx: Tx,
  context: SessionWriteContext,
  ids: IdGenerator,
  bind: (tx: Tx, context: SessionWriteContext) => DiscountDecisionReaders,
): DiscountDecisionTransaction {
  const scope = {
    companyId: context.companyId,
    businessId: context.businessId,
    branchId: context.branchId,
  };
  return {
    ...bind(tx, context),
    proposals: {
      peek: (proposalIds) => peekDiscountDecisions(tx, scope, proposalIds),
      lock: (proposalIds) => lockDiscountDecisions(tx, scope, proposalIds),
      decide: (plan, decider) => decideDiscountProposals(tx, scope, plan, decider),
    },
    idempotent: async (handler) => {
      const outcome = await runIdempotent(tx, {
        scope: 'COMPANY',
        operation: DECISION_OPERATION,
        key: context.key,
        fingerprint: context.fingerprint,
      }, async () => ({ status: 200, body: await handler() }));
      return { body: outcome.body as Awaited<ReturnType<typeof handler>>, replayed: outcome.replayed };
    },
    audit: async (entries) => {
      await appendAuditLogs(tx, entries.map((entry) => ({ id: ids.newId(), entry })));
    },
    emit: async (payload) => {
      await appendOutboxEvent(tx, ids.newId(), {
        aggregateType: 'discount_approval_decision',
        aggregateId: ids.newId(),
        eventType: 'DiscountApprovedByPerformer',
        payload: discountApprovedByPerformer.parse(payload),
      });
    },
  };
}
