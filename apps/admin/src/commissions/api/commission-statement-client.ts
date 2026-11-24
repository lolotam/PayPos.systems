import {
  commissionStatementReturnResult,
  commissionStatementReviewResult,
  commissionStatementView,
  type CommissionStatementReturnInput,
  type CommissionStatementReturnResult,
  type CommissionStatementReviewInput,
  type CommissionStatementReviewResult,
  type CommissionStatementView,
} from '@pospay/contracts';
import { apiClient } from '@/shared/api/client';
import { parseStatementReading, type StatementReading } from '../model/statement-reading';
// قاعدة الرفض واحدة لكل عملاء العمولة: الحالة بتتفحص قبل الجسم عشان 403 بجسم فاضي ما يضيعش.
import { refusal } from './commission-plans-client';

const statementPath = '/v1/businesses/{businessId}/commission-statements/{period}';
const generatePath = `${statementPath}/generate`;
const reviewPath = `${statementPath}/review`;
const returnPath = `${statementPath}/return`;

/** هوية الشاشة: الشركة والنشاط والمستخدم، عشان كاش كل هوية لوحده. */
export type StatementScope = readonly ['commission-statement', string, string, string];

export function statementScope(companyId: string, businessId: string, userId: string): StatementScope {
  return ['commission-statement', companyId, businessId, userId] as const;
}

/** مفتاح قراءة كشف شهر واحد. */
export function statementKey(scope: StatementScope, period: string) {
  return [...scope, 'view', period] as const;
}

function callParams(scope: StatementScope, period: string, idempotencyKey: string) {
  return {
    header: { 'x-company-id': scope[1], 'Idempotency-Key': idempotencyKey },
    path: { businessId: scope[2], period },
  };
}

/** بيجيب كشف الشهر وبيحلله بسكيما العقد حسب نطاق القارئ والحالة. */
export async function fetchStatement(
  scope: StatementScope,
  period: string,
  signal: AbortSignal,
): Promise<StatementReading> {
  const result = await apiClient().GET(statementPath, {
    params: { header: { 'x-company-id': scope[1] }, path: { businessId: scope[2], period } },
    signal,
  });
  if (!result.response.ok) throw refusal(result.error ?? {}, result.response.status);
  return parseStatementReading(result.data);
}

/** بيعمل الكشف أو بيحدّثه بمفتاح Idempotency، وبيرجّع العرض الكامل بعد تحليله. */
export async function generateStatement(
  scope: StatementScope,
  period: string,
  idempotencyKey: string,
): Promise<CommissionStatementView> {
  const result = await apiClient().POST(generatePath, {
    params: callParams(scope, period, idempotencyKey),
  });
  if (!result.response.ok) throw refusal(result.error ?? {}, result.response.status);
  return commissionStatementView.parse(result.data);
}

/** بيراجع الكشف بالبصمتين اللي شافهما المراجع. */
export async function reviewStatement(
  scope: StatementScope,
  period: string,
  idempotencyKey: string,
  body: CommissionStatementReviewInput,
): Promise<CommissionStatementReviewResult> {
  const result = await apiClient().POST(reviewPath, {
    params: callParams(scope, period, idempotencyKey),
    body,
  });
  if (!result.response.ok) throw refusal(result.error ?? {}, result.response.status);
  return commissionStatementReviewResult.parse(result.data);
}

/** بيرجّع الكشف المراجَع للمسودة بالسبب اللي اتكتب. */
export async function returnStatement(
  scope: StatementScope,
  period: string,
  idempotencyKey: string,
  body: CommissionStatementReturnInput,
): Promise<CommissionStatementReturnResult> {
  const result = await apiClient().POST(returnPath, {
    params: callParams(scope, period, idempotencyKey),
    body,
  });
  if (!result.response.ok) throw refusal(result.error ?? {}, result.response.status);
  return commissionStatementReturnResult.parse(result.data);
}
