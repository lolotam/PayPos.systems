import type { ClaimedEvent, IdGenerator } from '@pospay/db';
import type { CommissionTenant } from '../../../../../../packages/db/test/commission-statement-fixtures.ts';

export interface CommissionTipEventOverrides {
  readonly id?: string;
  readonly companyId?: string;
  readonly aggregateType?: string;
  readonly aggregateId?: string;
  readonly sessionId?: string;
  readonly businessId?: string;
  readonly branchId?: string;
  readonly occurredAt?: string;
  readonly businessDate?: string;
  readonly revision?: number;
  readonly changedAt?: string;
  readonly tips?: readonly {
    readonly employee_id: string;
    readonly method: 'CASH' | 'CARD';
    readonly amount: string;
  }[];
  readonly attempt?: number;
  readonly payloadOverrides?: Record<string, unknown>;
}

export interface CommissionSalaryEventOverrides {
  readonly id?: string;
  readonly companyId?: string;
  readonly aggregateType?: string;
  readonly aggregateId?: string;
  readonly employeeId?: string;
  readonly businessId?: string | null;
  readonly effectiveFrom?: string;
  readonly amount?: string;
  readonly revision?: number;
  readonly attempt?: number;
  readonly payloadOverrides?: Record<string, unknown>;
}

/**
 * يبني حدث SessionTipsChanged مكتمل بغلاف ClaimedEvent صالح للاختبار.
 */
export function commissionTipEvent(
  tenant: CommissionTenant,
  ids: IdGenerator,
  overrides: CommissionTipEventOverrides = {},
): ClaimedEvent {
  const sessionId = overrides.sessionId ?? ids.newId();
  const payload = {
    schema_version: 1,
    session_id: sessionId,
    business_id: overrides.businessId ?? tenant.business,
    branch_id: overrides.branchId ?? tenant.branch,
    occurred_at: overrides.occurredAt ?? '2026-11-01T09:00:00.000Z',
    business_date: overrides.businessDate ?? '2026-11-01',
    revision: overrides.revision ?? 1,
    changed_at: overrides.changedAt ?? '2026-11-01T09:00:00.000Z',
    tips: overrides.tips ?? [
      { employee_id: tenant.employee, method: 'CARD', amount: '10.000' },
    ],
    ...overrides.payloadOverrides,
  };
  return {
    companyId: overrides.companyId ?? tenant.company,
    id: overrides.id ?? ids.newId(),
    aggregateType: overrides.aggregateType ?? 'service_session',
    aggregateId: overrides.aggregateId ?? sessionId,
    eventType: 'SessionTipsChanged',
    payload,
    attempt: overrides.attempt ?? 1,
  };
}

/**
 * يبني حدث SalaryChanged مكتمل بغلاف ClaimedEvent؛ دعم الأحداث القديمة بلا business_id.
 */
export function commissionSalaryEvent(
  tenant: CommissionTenant,
  ids: IdGenerator,
  overrides: CommissionSalaryEventOverrides = {},
): ClaimedEvent {
  const employeeId = overrides.employeeId ?? tenant.employee;
  const businessId =
    'businessId' in overrides ? (overrides.businessId ?? undefined) : tenant.business;
  const payload = {
    employee_id: employeeId,
    ...(businessId !== undefined ? { business_id: businessId } : {}),
    effective_from: overrides.effectiveFrom ?? '2026-11-01',
    amount: overrides.amount ?? '500.000',
    revision: overrides.revision ?? 1,
    ...overrides.payloadOverrides,
  };
  return {
    companyId: overrides.companyId ?? tenant.company,
    id: overrides.id ?? ids.newId(),
    aggregateType: overrides.aggregateType ?? 'employee',
    aggregateId: overrides.aggregateId ?? employeeId,
    eventType: 'SalaryChanged',
    payload,
    attempt: overrides.attempt ?? 1,
  };
}

export interface CommissionSaleEventOverrides {
  readonly id?: string;
  readonly companyId?: string;
  readonly aggregateType?: string;
  readonly aggregateId?: string;
  readonly saleId?: string;
  readonly businessId?: string;
  readonly branchId?: string;
  readonly sellerEmployeeId?: string;
  readonly soldAt?: string;
  readonly businessDate?: string;
  readonly pricePaid?: string;
  readonly refundedAmount?: string;
  readonly revision?: number;
  readonly attempt?: number;
  readonly payloadOverrides?: Record<string, unknown>;
}

/** يبني حدث PackageSaleChanged مكتمل بغلاف ClaimedEvent؛ هوية البيع هي المجمّع. */
export function commissionSaleEvent(
  tenant: CommissionTenant,
  ids: IdGenerator,
  overrides: CommissionSaleEventOverrides = {},
): ClaimedEvent {
  const saleId = overrides.saleId ?? ids.newId();
  const payload = {
    sale_id: saleId,
    business_id: overrides.businessId ?? tenant.business,
    branch_id: overrides.branchId ?? tenant.branch,
    sold_at: overrides.soldAt ?? '2026-10-31T21:30:00.000Z',
    business_date: overrides.businessDate ?? '2026-11-01',
    seller_employee_id: overrides.sellerEmployeeId ?? tenant.employee,
    price_paid: overrides.pricePaid ?? '30.000',
    refunded_amount: overrides.refundedAmount ?? '0.000',
    status: 'SOLD',
    revision: overrides.revision ?? 1,
    schema_version: 1,
    ...overrides.payloadOverrides,
  };
  return {
    companyId: overrides.companyId ?? tenant.company,
    id: overrides.id ?? ids.newId(),
    aggregateType: overrides.aggregateType ?? 'package_entitlement',
    aggregateId: overrides.aggregateId ?? saleId,
    eventType: 'PackageSaleChanged',
    payload,
    attempt: overrides.attempt ?? 1,
  };
}
