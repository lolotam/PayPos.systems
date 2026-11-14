import type { FastifyRequest } from 'fastify';
import { PackageSalesController } from '../http/package-sales.controller.ts';
import { createPackageSaleRequestTransactions } from '../persistence/package-sale-request.transactions.ts';
import { AcceptPackageSaleUseCase } from '../use-cases/accept-package-sale/accept-package-sale.usecase.ts';
import { AT, ids, sessionFixture, type SessionFixture } from './session.fixture.ts';

export interface PackageSaleRequestFixture {
  f: SessionFixture;
  setAt(next: Date): void;
}

export async function packageSaleRequestFixture(): Promise<PackageSaleRequestFixture> {
  let at = AT;
  const clock = { now: () => at };
  const f = await sessionFixture({ ordersClock: clock });
  try {
    await f.h.owner`INSERT INTO permission_overrides
      (company_id,id,membership_id,permission_code,effect,scope_type,scope_id,expires_at,reason,granted_by)
      VALUES(${f.company},${ids.newId()},${f.membership},'sell:packages:branch','ALLOW','BRANCH',${f.branch},
        NULL,'Synthetic package sale grant',${f.ownerId})`;
    const [ownerMembership] = await f.h.owner`SELECT id FROM memberships
      WHERE company_id = ${f.company} AND user_id = ${f.ownerId}`;
    if (ownerMembership?.['id']) {
      await f.h.owner`INSERT INTO permission_overrides
        (company_id,id,membership_id,permission_code,effect,scope_type,scope_id,expires_at,reason,granted_by)
        VALUES(${f.company},${ids.newId()},${ownerMembership['id']},'sell:packages:branch','ALLOW','COMPANY',${f.company},
          NULL,'Synthetic owner package sale grant',${f.ownerId})
        ON CONFLICT DO NOTHING`;
    }
    return {
      f,
      setAt(next: Date) {
        at = next;
        f.setAt(next);
      },
    };
  } catch (error) {
    await f.close();
    throw error;
  }
}

export function saleBody(
  f: SessionFixture,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    customer_id: f.customer,
    package_type_id: ids.newId(),
    expected_type_revision: 1,
    expected_service_revisions: [{ service_id: f.services[0], revision: 1 }],
    price_paid: '50.000',
    paid_method: 'CARD',
    seller_employee_id: f.employees[0],
    ...overrides,
  };
}

export interface RequestOptions {
  body?: Record<string, unknown>;
  cookie?: string;
  company?: string;
  key?: string;
  businessId?: string;
  branchId?: string;
}

export function salePath(f: SessionFixture, businessId = f.business, branchId = f.branch): string {
  return `/v1/businesses/${businessId}/branches/${branchId}/package-sales`;
}

export async function postSale(f: SessionFixture, options: RequestOptions = {}) {
  return f.h.send('POST', salePath(f, options.businessId, options.branchId), {
    cookie: options.cookie ?? f.cookie,
    company: options.company ?? f.company,
    key: options.key ?? ids.newId(),
    body: options.body ?? saleBody(f),
  });
}

export async function readSaleRequests(f: SessionFixture, companyId = f.company) {
  return f.h.owner`SELECT id, company_id, business_id, branch_id, recorded_by,
    recorded_by_membership_id, discount_limit_bps, customer_id, package_type_id,
    expected_type_revision, expected_service_revisions, price_paid::text AS price_paid,
    paid_method, seller_employee_id, sold_at::text AS sold_at, recorded_at::text AS recorded_at,
    status
    FROM package_sale_requests WHERE company_id = ${companyId}`;
}

export async function readSaleOutbox(f: SessionFixture, requestId: string) {
  return f.h.owner`SELECT id, aggregate_type, aggregate_id, event_type, payload
    FROM outbox WHERE aggregate_id = ${requestId}`;
}

export async function cleanPackageSales(f: SessionFixture): Promise<void> {
  await f.h.owner`DELETE FROM package_sale_requests WHERE company_id = ${f.company}`;
  await f.h.owner`DELETE FROM idempotency_keys WHERE company_id = ${f.company}`;
  await f.h.owner`DELETE FROM outbox WHERE aggregate_type = 'package_sale_request'`;
}

export function buildPackageSalesController(f: SessionFixture) {
  const transactions = createPackageSaleRequestTransactions(f.db, ids);
  const useCase = new AcceptPackageSaleUseCase(transactions, ids, f.clock);
  return new PackageSalesController(useCase);
}

export function createControllerRequest(
  f: SessionFixture,
  options: { companyId?: string; userId?: string } = {},
): FastifyRequest {
  return {
    principal: {
      kind: 'user',
      companyId: options.companyId ?? f.company,
      userId: options.userId ?? f.userId,
    },
    method: 'POST',
    routeOptions: {
      url: '/v1/businesses/:businessId/branches/:branchId/package-sales',
    },
    query: {},
  } as unknown as FastifyRequest;
}
