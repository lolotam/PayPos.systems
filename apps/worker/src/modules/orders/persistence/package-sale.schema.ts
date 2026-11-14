import { z } from 'zod';
import type { PackageSaleRequest } from '../ports/package-sale.port.ts';

const id = z.uuid().transform((value) => value.toLowerCase());
const money = z.string().regex(/^(0|[1-9]\d{0,10})\.\d{3}$/);
const revision = z.object({
  service_id: id,
  revision: z.number().int().min(1),
}).strict();
const schema = z.object({
  id,
  business_id: id,
  branch_id: id,
  recorded_by: id,
  recorded_by_membership_id: id,
  discount_limit_bps: z.number().int().min(0).max(10000).nullable(),
  customer_id: id,
  package_type_id: id,
  expected_type_revision: z.number().int().min(1),
  expected_service_revisions: z.array(revision).min(1).max(20),
  price_paid: money,
  paid_method: z.enum(['CASH', 'CARD']),
  seller_employee_id: id,
  sold_at: z.iso.datetime().nullable(),
  recorded_at: z.iso.datetime(),
}).strict();

export function parsePackageSaleRequest(value: unknown): PackageSaleRequest {
  const result = schema.safeParse(value);
  if (!result.success) throw new Error('PACKAGE_SALE_REQUEST_INVALID');
  return result.data;
}
