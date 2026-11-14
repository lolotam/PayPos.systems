import {
  appendAuditLog,
  appendOutboxEvent,
  type IdGenerator,
  type Tx,
} from '@pospay/db';
import { parseMoney, type SalePackageType } from '@pospay/domain';
import { sql } from 'drizzle-orm';
import {
  lockSessionServicesForSale,
  readPackageTypeForSale,
} from '../../catalog/index.ts';
import { packageSaleCustomerExists } from '../../customers/index.ts';
import { lockPackageSeller, readPackageSeller } from '../../staff/index.ts';
import { packageSalePlace } from '../../tenancy/index.ts';
import { saleAudit } from '../domain/package-sale-audit.ts';
import type {
  PackageSaleRequest,
  PackageSaleScope,
} from '../ports/package-sale.port.ts';
import { insertPackageSale } from './package-sale.writes.ts';

type SaleContext = {
  readonly tx: Tx;
  readonly ids: IdGenerator;
  readonly companyId: string;
  readonly request: PackageSaleRequest;
};

export function packageSaleScope(
  tx: Tx,
  ids: IdGenerator,
  companyId: string,
  request: PackageSaleRequest,
): PackageSaleScope {
  const context = { tx, ids, companyId, request };
  return {
    request,
    lockType: () => lockSaleType(context),
    lockSeller: (employeeId) =>
      lockPackageSeller(tx, companyId, request.business_id, employeeId),
    readPlace: async () => {
      const timezone = await packageSalePlace(
        tx,
        companyId,
        request.business_id,
        request.branch_id,
      );
      return timezone === null ? null : { timezone };
    },
    customerExists: (customerId) => packageSaleCustomerExists(tx, companyId, customerId),
    readSeller: (employeeId, businessDate) =>
      readPackageSeller(
        tx,
        companyId,
        request.business_id,
        request.branch_id,
        employeeId,
        businessDate,
      ),
    insert: (plan) => insertPackageSale(tx, plan),
    audit: (plan) => appendAuditLog(tx, ids.newId(), saleAudit(plan)),
    emit: (plan) =>
      appendOutboxEvent(tx, ids.newId(), {
        aggregateType: 'package_entitlement',
        aggregateId: plan.entitlement.id,
        eventType: 'PackageSaleChanged',
        payload: plan.event,
      }),
    complete: (entitlementId, at) => completeSale(context, entitlementId, at),
  };
}

async function lockSaleType(context: SaleContext): Promise<SalePackageType | null> {
  const { tx, companyId, request } = context;
  const type = await readPackageTypeForSale(
    tx,
    companyId,
    request.business_id,
    request.package_type_id,
  );
  if (type === null) return null;
  const services: Awaited<ReturnType<typeof lockSessionServicesForSale>> =
    type.components.length === 0
      ? []
      : await lockSessionServicesForSale(
          tx,
          companyId,
          request.business_id,
          type.components.map((component) => component.service_id),
        );
  const byId = new Map(services.map((service) => [service.id, service]));
  return {
    id: type.id,
    name_en: type.name_en,
    name_ar: type.name_ar,
    price: parseMoney(type.price),
    validity_days: type.validity_days,
    revision: type.revision,
    selling_stopped_at: type.selling_stopped_at,
    components: type.components.map((component) => {
      const service = byId.get(component.service_id);
      if (service === undefined) throw new Error('Package component service missing');
      return {
        service_id: component.service_id,
        sessions: component.sessions,
        position: component.position,
        service: {
          id: service.id,
          name_en: service.name_en,
          name_ar: service.name_ar,
          price: parseMoney(service.price),
          revision: service.revision,
        },
      };
    }),
  };
}

async function completeSale(
  context: SaleContext,
  entitlementId: string,
  at: string,
): Promise<void> {
  const completed = await context.tx.execute<{ id: string }>(sql`
    UPDATE package_sale_requests SET status='completed',entitlement_id=${entitlementId},finished_at=${at}
    WHERE company_id=${context.companyId} AND id=${context.request.id} AND status='pending'
    RETURNING id`);
  if (completed.length !== 1) throw new Error('PACKAGE_SALE_COMPLETION_CONFLICT');
}
