import { z } from 'zod';
import { responseObject } from '../response-object.js';
import { id as sharedId } from '../scalars/id.js';
import { timestamp } from '../scalars/timestamp.js';
import { packagePaidMethod } from './package-sale.js';
import { sessionMoney } from './service-session.js';

const id = sharedId.toLowerCase();
const businessDate = z.iso.date();
const count = z.number().int().nonnegative();
const cursor = z.string().min(1).max(4096).regex(/^[A-Za-z0-9_-]+$/);

export const customerPackagesQuery = z.strictObject({
  cursor: cursor.optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
}).meta({ id: 'CustomerPackagesQuery' });

export const customerPackageSlotValue = responseObject({
  unit_value: sessionMoney,
  free: count,
  used: count,
  refunded: count,
}).meta({ id: 'CustomerPackageSlotValue' });

export const customerPackageComponent = responseObject({
  id,
  service_id: id,
  position: z.number().int().min(1).max(20),
  name_en: z.string(),
  name_ar: z.string().nullable(),
  sessions_total: z.number().int().min(1).max(365),
  remaining: count,
  used: count,
  refunded: count,
  next_unit_value: sessionMoney.nullable(),
  slot_values: z.array(customerPackageSlotValue).min(1),
}).meta({ id: 'CustomerPackageComponent' });

export const customerPackageListItem = responseObject({
  id,
  provenance: z.enum(['SOLD', 'IMPORTED']),
  name_en: z.string(),
  name_ar: z.string().nullable(),
  expires_on: businessDate,
  expired: z.boolean(),
  used_up: z.boolean(),
  price_paid: sessionMoney,
  refunded_amount: sessionMoney,
  components: z.array(customerPackageComponent).min(1).max(20),
}).meta({ id: 'CustomerPackageListItem' });

export const customerPackagePage = responseObject({
  items: z.array(customerPackageListItem).max(50),
  next_cursor: cursor.nullable(),
}).meta({ id: 'CustomerPackagePage' });

export const customerPackageDetailSlot = responseObject({
  ordinal: z.number().int().min(1),
  state: z.enum(['FREE', 'USED', 'REFUNDED', 'IMPORTED_USED']),
  unit_value: sessionMoney,
}).meta({ id: 'CustomerPackageDetailSlot' });

export const customerPackageDetailComponent = responseObject({
  id,
  service_id: id,
  position: z.number().int().min(1).max(20),
  name_en: z.string(),
  name_ar: z.string().nullable(),
  list_price_snapshot: sessionMoney,
  component_value: sessionMoney,
  sessions_total: z.number().int().min(1).max(365),
  remaining: count,
  used: count,
  refunded: count,
  slots: z.array(customerPackageDetailSlot),
}).meta({ id: 'CustomerPackageDetailComponent' });

export const customerPackageDetail = responseObject({
  id,
  customer_id: id,
  package_type_id: id.nullable(),
  provenance: z.enum(['SOLD', 'IMPORTED']),
  name_en: z.string(),
  name_ar: z.string().nullable(),
  validity_days: z.number().int().positive().nullable(),
  list_price: sessionMoney.nullable(),
  price_paid: sessionMoney,
  discount: sessionMoney.nullable(),
  discount_bps: z.number().int().min(0).max(10000).nullable(),
  paid_method: packagePaidMethod.nullable(),
  seller_employee_id: id.nullable(),
  seller_linked_user_id: id.nullable(),
  sold_branch_id: id.nullable(),
  sold_at: timestamp.nullable(),
  sold_business_date: businessDate.nullable(),
  expires_on: businessDate,
  refunded_amount: sessionMoney,
  revision: z.number().int().positive(),
  components: z.array(customerPackageDetailComponent),
}).meta({ id: 'CustomerPackageDetail' });

export const customerPackagesCursorData = z.strictObject({
  company_id: id,
  business_id: id,
  branch_id: id,
  customer_id: id,
  rank: z.union([z.literal(0), z.literal(1)]),
  expires_on: businessDate.refine((value) => !value.startsWith('0000-')),
  id,
});

export type CustomerPackagesQuery = z.infer<typeof customerPackagesQuery>;
export type CustomerPackageSlotValue = z.infer<typeof customerPackageSlotValue>;
export type CustomerPackageComponent = z.infer<typeof customerPackageComponent>;
export type CustomerPackageListItem = z.infer<typeof customerPackageListItem>;
export type CustomerPackagePage = z.infer<typeof customerPackagePage>;
export type CustomerPackageDetailSlot = z.infer<typeof customerPackageDetailSlot>;
export type CustomerPackageDetailComponent = z.infer<typeof customerPackageDetailComponent>;
export type CustomerPackageDetail = z.infer<typeof customerPackageDetail>;
export type CustomerPackagesCursorData = z.infer<typeof customerPackagesCursorData>;

export const customerPackageSchemas = [
  customerPackagesQuery,
  customerPackageSlotValue,
  customerPackageComponent,
  customerPackageListItem,
  customerPackagePage,
  customerPackageDetailSlot,
  customerPackageDetailComponent,
  customerPackageDetail,
];
