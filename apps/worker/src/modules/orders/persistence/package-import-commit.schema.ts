import { z } from 'zod';
import { PackageCommitError } from '../domain/package-import-commit.ts';
const money = z.string().regex(/^(0|[1-9]\d{0,10})\.\d{3}$/);
const ordinal = z.number().int().min(2).max(502);
const component = z
  .object({
    service_id: z.uuid(),
    sessions: z.number().int().min(1).max(365),
    remaining: z.number().int().min(0).max(365),
    list_price_snapshot: money,
    component_value: money,
    base_unit_value: money,
    last_unit_value: money,
  })
  .strict();
const row = z
  .object({
    row: ordinal,
    customer_id: z.uuid(),
    phone_last3: z.string().regex(/^\d{3}$/),
    name_en: z.string().min(1).max(255),
    name_ar: z.string().min(1).max(255).nullable(),
    price_paid: money,
    expires_on: z.iso.date(),
    external_ref: z.string().min(1).max(100),
    components: z.array(component).min(1).max(20),
  })
  .strict();
const schema = z.object({
  id: z.uuid(),
  business_id: z.uuid(),
  created_by: z.uuid(),
  commit_membership_id: z.uuid().nullable(),
  requested_at: z.string().nullable(),
  expires_at: z.string(),
  row_count: z.number().int().min(0).max(500),
  error_count: z.number().int().min(0),
  skipped_count: z.number().int().min(0).max(500),
  source_rows: z.array(ordinal).max(500).nullable(),
  skipped_rows: z.array(ordinal).max(500).nullable(),
  rows: z.array(row).max(500),
  errors: z.array(z.unknown()),
});
export function parsePackageCommitPreview(value: unknown) {
  const result = schema.safeParse(value);
  if (!result.success) throw new PackageCommitError('IMPORT_COMMIT_FAILED');
  return result.data;
}
