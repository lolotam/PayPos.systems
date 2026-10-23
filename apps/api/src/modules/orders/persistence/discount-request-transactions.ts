import {
  IdempotencyKeyReusedError,
  appendAuditLogs,
  appendOutboxEvent,
  runIdempotent,
  type IdGenerator,
  type TenantWrappers,
  type Tx,
} from '@pospay/db';
import { discountApprovalRequested } from '@pospay/contracts';
import { sql } from 'drizzle-orm';
import { DiscountApprovalError } from '../domain/discount-approval-error.ts';
import { SessionError } from '../domain/session-error.ts';
import type {
  DiscountRequestAccessPort,
  DiscountRequestTransactions,
} from '../ports/discount-request.port.ts';
import type { EditorNamePort } from '../ports/line-edit.port.ts';
import type { SessionWriteContext } from '../ports/service-session-transactions.port.ts';
import type {
  CatalogReaderPort,
  CustomerLookupPort,
  DiscountLimitPort,
  PerformerCheckPort,
  SessionPlacePort,
} from '../ports/session-readers.port.ts';
import { insertDiscountProposals } from './discount-proposal-writes.ts';
import { loadSession } from './session-records.ts';
import { cleanSessionWrite } from './session-recovery-proof.ts';

const REQUEST_OPERATION = 'request-discount-approval';

/** القراءات التي يحتاجها الطلب داخل معاملته؛ persistence وحدها تعرف Tx. */
export interface DiscountRequestReaders {
  place: SessionPlacePort;
  access: DiscountRequestAccessPort;
  catalog: CatalogReaderPort;
  customer: CustomerLookupPort;
  performers: PerformerCheckPort;
  discount: DiscountLimitPort;
  requesterName: EditorNamePort;
}

/**
 * يبني معاملات طلب الموافقة: معاملة واحدة تكتب الاقتراحات والتدقيق والحدث والرد المحفوظ معاً.
 * قفل الزيارة هو نفسه المستخدم في التسجيل والإضافة، فالطلب والإضافة يتسلسلان على نفس الزيارة.
 *
 * @param database أغلفة المستأجر
 * @param ids مولّد الهويات لصفوف التدقيق والحدث
 * @param bind ربط القراءات داخل المعاملة
 * @returns مصنع معاملات الطلب
 */
export function createDiscountRequestTransactions(
  database: TenantWrappers,
  ids: IdGenerator,
  bind: (tx: Tx, context: SessionWriteContext) => DiscountRequestReaders,
): DiscountRequestTransactions {
  return {
    run: async (context, work) => {
      try {
        return await database.withTenant(
          context.companyId,
          async (tx) => work({
            ...bind(tx, context),
            sessions: {
              load: (id) => loadSession(tx, context.companyId, context.businessId, context.branchId, id),
              lock: async (id) => {
                await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(app_company_id()::text || ':service_session:' || ${id}::uuid::text,0))`);
              },
            },
            proposals: {
              insert: (proposals) => insertDiscountProposals(tx, context.companyId, context.businessId, context.branchId, proposals),
            },
            idempotent: async (handler) => {
              const result = await runIdempotent(tx, {
                scope: 'COMPANY',
                operation: REQUEST_OPERATION,
                key: context.key,
                fingerprint: context.fingerprint,
              }, async () => ({ status: 201, body: await handler() }));
              return { body: result.body as Awaited<ReturnType<typeof handler>>, replayed: result.replayed };
            },
            audit: async (entries) => {
              await appendAuditLogs(tx, entries.map((entry) => ({ id: ids.newId(), entry })));
            },
            emit: async (requestId, payload) => {
              await appendOutboxEvent(tx, ids.newId(), {
                aggregateType: 'discount_approval_request',
                aggregateId: requestId,
                eventType: 'DiscountApprovalRequested',
                payload: discountApprovalRequested.parse(payload),
              });
            },
          }),
          { userId: context.userId },
        );
      } catch (error) {
        mapRequestError(error);
      }
    },
  };
}

function mapRequestError(error: unknown): never {
  if (error instanceof DiscountApprovalError) throw error;
  if (error instanceof IdempotencyKeyReusedError) throw new SessionError('IDEMPOTENCY_KEY_REUSED');
  cleanSessionWrite(error);
}
