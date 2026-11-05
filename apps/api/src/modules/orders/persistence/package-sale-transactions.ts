import {
  appendAuditLogs,
  appendOutboxEvent,
  IdempotencyKeyBusyError,
  IdempotencyKeyReusedError,
  runIdempotent,
  type IdGenerator,
  type TenantWrappers,
  type Tx,
} from '@pospay/db';

import { PackageRuleError, PackageSaleError, PackageSalePricingError } from '../domain/errors.ts';
import { saleAudit } from '../domain/package-sale-audit.ts';
import { SessionError } from '../domain/session-error.ts';
import type {
  PackageSaleContext,
  PackageSalePlan,
  PackageSaleTransaction,
  PackageSaleTransactions,
} from '../ports/package-sale-transactions.port.ts';
import { insertPackageSale } from './package-sale-writes.ts';
import { RETRYABLE_SQLSTATE } from './session-recovery-proof.ts';

/** القراءات اللي البائع محتاجها؛ الـ persistence وحدها تعرف Tx. */
export type PackageSaleReaders = Pick<
  PackageSaleTransaction,
  'place' | 'access' | 'catalog' | 'customer' | 'performers' | 'discount'
>;

/**
 * يترجم خطأ التخزين لرفض مسمّى، مع الحفاظ على رفضات البيع زي ما هي.
 * رفضات الباقة والجلسة وأخطاء إعادة الطلب بتعدّي زي ما هي؛ غير كده بيتحوّل لخطأ قابل لإعادة المحاولة.
 *
 * @param error الخطأ اللي خرج من المعاملة
 * @returns لا شيء؛ الخطأ بيت thrown دايماً
 */
function cleanPackageSaleWrite(error: unknown): never {
  const seen = new Set<unknown>();
  let depth = 0;
  for (
    let current = error;
    typeof current === 'object' && current !== null && !seen.has(current);
    current = (current as { cause?: unknown }).cause
  ) {
    seen.add(current);
    if (
      depth === 0 &&
      (current instanceof PackageSaleError ||
        current instanceof PackageSalePricingError ||
        current instanceof PackageRuleError ||
        current instanceof SessionError ||
        current instanceof IdempotencyKeyBusyError ||
        current instanceof IdempotencyKeyReusedError)
    ) {
      throw current;
    }
    const code = String((current as { code?: unknown }).code);
    if (RETRYABLE_SQLSTATE.has(code)) throw new SessionError('TRANSACTION_RETRY_REQUIRED');
    depth += 1;
  }
  throw new Error('PACKAGE_SALE_PERSISTENCE_FAILED');
}

/**
 * يربط بيع الباقة بمعاملة الشركة: الحفظ والتدقيق والحدث والرد المحفوظ كلهم مع بعض.
 *
 * @param database أغلفةTenant اللي بتدخّل الشركة
 * @param ids مولّد الهويات المحقون
 * @param bind ربط القراءات بنفس معاملة البيع
 * @returns منفذ المعاملات بتاع بيع الباقة
 */
export function createPackageSaleTransactions(
  database: TenantWrappers,
  ids: IdGenerator,
  bind: (tx: Tx, context: PackageSaleContext) => PackageSaleReaders,
): PackageSaleTransactions {
  return {
    run: async (context, work) => {
      try {
        return await database.withTenant(
          context.companyId,
          async (tx) =>
            work({
              ...bind(tx, context),
              idempotent: async (operation, handler) => {
                const result = await runIdempotent(
                  tx,
                  {
                    scope: 'COMPANY',
                    operation,
                    key: context.key,
                    fingerprint: context.fingerprint,
                  },
                  async () => ({ status: 201, body: await handler() }),
                );
                return {
                  body: result.body as Awaited<ReturnType<typeof handler>>,
                  replayed: result.replayed,
                };
              },
              insert: (plan: PackageSalePlan) => insertPackageSale(tx, plan),
              audit: async (plan: PackageSalePlan) => {
                await appendAuditLogs(tx, [{ id: ids.newId(), entry: saleAudit(plan) }]);
              },
              emit: async (plan: PackageSalePlan) => {
                await appendOutboxEvent(tx, ids.newId(), {
                  aggregateType: 'package_entitlement',
                  aggregateId: plan.entitlement.id,
                  eventType: 'PackageSaleChanged',
                  payload: plan.event,
                });
              },
            }),
          { userId: context.userId },
        );
      } catch (error) {
        cleanPackageSaleWrite(error);
      }
    },
  };
}
