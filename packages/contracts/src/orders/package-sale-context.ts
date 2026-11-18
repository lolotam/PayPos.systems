import { z } from 'zod';
import { responseObject } from '../response-object.js';
import { id } from '../scalars/id.js';
import { timestamp } from '../scalars/timestamp.js';
import { sessionPerformerOption, sessionPerformerOptionPage } from './service-session-options.js';

export const packageSaleRecorder = responseObject({
  membership_id: id,
  scope_type: z.enum(['COMPANY', 'BUSINESS', 'BRANCH']),
  scope_id: id,
}).meta({ id: 'PackageSaleRecorder' });

export const packageSaleContext = responseObject({
  generated_at: timestamp,
  business_timezone: z.string().min(1),
  customer_entry_scope: z.enum(['branch', 'business', 'company']).nullable(),
  recorders: z.array(packageSaleRecorder).min(1),
}).meta({ id: 'PackageSaleContext' });

export const packageSaleSellerOption = sessionPerformerOption
  .pick({ id: true, name_ar: true, name_en: true, employee_number: true })
  .meta({ id: 'PackageSaleSellerOption' });

export const packageSaleSellerOptionPage = responseObject({
  sale_anchor: timestamp,
  items: z.array(packageSaleSellerOption).max(100),
  next_cursor: sessionPerformerOptionPage.shape.next_cursor,
}).meta({ id: 'PackageSaleSellerOptionPage' });

export const packageSaleContextSchemas = [
  packageSaleRecorder,
  packageSaleContext,
  packageSaleSellerOption,
  packageSaleSellerOptionPage,
];

export type PackageSaleRecorder = z.infer<typeof packageSaleRecorder>;
export type PackageSaleContext = z.infer<typeof packageSaleContext>;
export type PackageSaleSellerOption = z.infer<typeof packageSaleSellerOption>;
export type PackageSaleSellerOptionPage = z.infer<typeof packageSaleSellerOptionPage>;
