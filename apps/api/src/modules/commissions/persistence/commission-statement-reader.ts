import type { TenantWrappers, Tx } from '@pospay/db';

import type { CommissionStatementReader } from '../ports/commission-statement.port.ts';
import type { CommissionStatementProviders } from '../ports/commission-statement-providers.port.ts';
import { readCommissionStatementSource } from './commission-statement-source.ts';

/** طلب القراءة: الشركة والمستخدم والنشاط والشهر. */
interface StatementReadRequest {
  readonly companyId: string;
  readonly userId: string;
  readonly businessId: string;
  readonly period: string;
}

/**
 * مصنع قارئ الكشف: بيفتح معاملة قراءة فقط ويقرا كل المصادر في لقطة واحدة (D-25). المعاملة READ ONLY
 * فمفيش طريق يكتب أو ينشئ صف كشف أو يقفل من غير ما السطر يبان في الكود، واللقطة الواحدة بتخلي بصمتي
 * العرض ونطاق القارئ على نفس البيانات.
 *
 * @param database واجهات الداتابيز اللي بتفتح معاملة المستأجر
 * @param providers مزودو النطاق والأسماء والارتباطات المربوطين في جذر التطبيق
 * @returns قارئ الكشف
 */
export function createCommissionStatementReader(
  database: TenantWrappers,
  providers: CommissionStatementProviders,
): CommissionStatementReader {
  return {
    read: async (input) =>
      // معاملة واحدة: إثبات العضوية تحت سياق المستخدم ثم سياق الشركة (ADR-0003 §4). معاملة من غير عضوية
      // سارية بترجع null، وده رفض موحّد.
      (await database.withMember(
        input.userId,
        input.companyId,
        (tx) => readStatementInputs(tx, input, providers),
        { readOnly: true },
      )) ?? { kind: 'forbidden' },
  };
}

/** بيفحص النطاق والميزة ويقرا مصادر الكشف من معاملة القراءة الواحدة. */
async function readStatementInputs(
  tx: Tx,
  request: StatementReadRequest,
  providers: CommissionStatementProviders,
): ReturnType<CommissionStatementReader['read']> {
  const scope = await providers.scope(tx, request.companyId, request.userId, request.businessId);
  if (scope.kind === 'forbidden') return { kind: 'forbidden' };
  if (scope.kind === 'feature_disabled') return { kind: 'feature_disabled' };
  if (!(await providers.featureEnabled(tx, request.companyId))) return { kind: 'feature_disabled' };
  const source = await readCommissionStatementSource(tx, request, providers);
  return {
    kind: 'ok',
    read: { businessWide: scope.businessWide, branchIds: scope.branchIds, source },
  };
}
