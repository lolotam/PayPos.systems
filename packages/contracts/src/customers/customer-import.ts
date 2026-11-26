import { z } from 'zod';
import { responseObject } from '../response-object.js';
import { id } from '../scalars/id.js';

/** العناوين العشرة بترتيبها المرجعي: مرجع القالب والمعاينة معاً (073 FR-001). */
export const CUSTOMER_IMPORT_HEADERS = [
  'name',
  'phone',
  'country_code',
  'locale',
  'no_rating',
  'birthday',
  'year_known',
  'gender',
  'email',
  'notes',
] as const;

export const customerImportColumn = z
  .enum([...CUSTOMER_IMPORT_HEADERS, 'unexpected_column'])
  .meta({ id: 'CustomerImportColumn' });

export const customerImportErrorCode = z
  .enum([
    'IMPORT_REQUIRED_CELL',
    'IMPORT_NAME_INVALID',
    'IMPORT_PHONE_INVALID',
    'IMPORT_COUNTRY_CODE_INVALID',
    'IMPORT_LOCALE_INVALID',
    'IMPORT_BOOLEAN_INVALID',
    'IMPORT_DATE_INVALID',
    'IMPORT_YEAR_KNOWN_REQUIRED',
    'IMPORT_GENDER_INVALID',
    'IMPORT_EMAIL_INVALID',
    'IMPORT_NOTE_INVALID',
    'IMPORT_CELL_INVALID',
    'IMPORT_COLUMN_UNEXPECTED',
    'IMPORT_DUPLICATE_IN_FILE',
  ])
  .meta({ id: 'CustomerImportErrorCode' });

const customerImportWarningCodes = ['EXISTING_NO_RATING_IGNORED'] as const;

export const customerImportWarningCode = z
  .enum(customerImportWarningCodes)
  .meta({ id: 'CustomerImportWarningCode' });

export const customerImportRowError = responseObject({
  row: z.number().int().min(2),
  column: customerImportColumn,
  code: customerImportErrorCode,
}).meta({ id: 'CustomerImportRowError' });

export const customerImportRowStatus = z
  .enum(['new', 'existing'])
  .meta({ id: 'CustomerImportRowStatus' });

/** الصف المعروض: الهاتف المقنّع والبيانات العامة بس دون تاريخ ميلاد أو نوع أو بريد أو ملاحظة (CIM-06). */
export const customerImportRow = responseObject({
  row: z.number().int().min(2),
  masked_phone: z.string().regex(/^\*\*\*[0-9]{2,3}(?![\s\S])/),
  name: z.string().min(1).max(200),
  locale: z.enum(['ar', 'en']),
  status: customerImportRowStatus,
  warning: z
    .enum(customerImportWarningCodes)
    .nullable()
    .meta({ enum: [...customerImportWarningCodes, null] }),
}).meta({ id: 'CustomerImportRow' });

export const customerImportTemplate = responseObject({
  file_name: z.string().min(1).max(255),
  content_type: z.literal('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'),
  content_base64: z.string().min(1),
}).meta({ id: 'CustomerImportTemplate' });

export const previewCustomerImportInput = z
  .strictObject({ file_id: id })
  .meta({ id: 'PreviewCustomerImportInput' });

const excelRowNumberPattern = new RegExp(
  '^(?:' +
    '[2-9]|[1-9][0-9]{1,5}|' +
    '10[0-3][0-9]{4}|104[0-7][0-9]{3}|' +
    '1048[0-4][0-9]{2}|10485[0-6][0-9]|104857[0-6]' +
    ')$',
);
const customerImportRowsCursorValue = z
  .string()
  .regex(excelRowNumberPattern)
  .describe('Original Excel row number from 2 through 1048576.');
export const customerImportRowsCursor = customerImportRowsCursorValue.meta({
  id: 'CustomerImportRowsCursor',
});
const nextCustomerImportRowsCursor = customerImportRowsCursorValue.nullable();

export const customerImportRowsQuery = z
  .strictObject({
    cursor: customerImportRowsCursor.optional(),
    limit: z.coerce.number().int().min(1).max(100).default(20),
  })
  .meta({ id: 'CustomerImportRowsQuery' });

export const customerImportPreview = responseObject({
  preview_id: id,
  row_count: z.number().int().min(0).max(500),
  new_count: z.number().int().min(0).max(500),
  existing_count: z.number().int().min(0).max(500),
  error_count: z.number().int().min(0).max(5500),
  errors: z.array(customerImportRowError).max(5500),
  rows: z.array(customerImportRow).max(20),
  next_cursor: nextCustomerImportRowsCursor,
}).meta({ id: 'CustomerImportPreview' });

export const customerImportRowsPage = responseObject({
  items: z.array(customerImportRow).max(100),
  next_cursor: nextCustomerImportRowsCursor,
}).meta({ id: 'CustomerImportRowsPage' });

const customerImportCommitErrorCodes = [
  'IMPORT_PREVIEW_EXPIRED',
  'IMPORT_PREVIEW_HAS_ERRORS',
  'IMPORT_COMMIT_FAILED',
] as const;

export const customerImportCommitErrorCode = z
  .enum(customerImportCommitErrorCodes)
  .meta({ id: 'CustomerImportCommitErrorCode' });

export const customerImportStatus = responseObject({
  preview_id: id,
  status: z.enum(['ready', 'commit_requested', 'committed', 'failed']),
  created_count: z.number().int().min(0).max(500),
  error_code: z
    .enum(customerImportCommitErrorCodes)
    .nullable()
    .meta({ enum: [...customerImportCommitErrorCodes, null] }),
}).meta({ id: 'CustomerImportStatus' });

export const commitCustomerImportInput = z
  .strictObject({ preview_id: id })
  .meta({ id: 'CommitCustomerImportInput' });

export const customerImportCommitAccepted = responseObject({ preview_id: id }).meta({
  id: 'CustomerImportCommitAccepted',
});

export const customerImportSchemas = [
  customerImportColumn,
  customerImportErrorCode,
  customerImportWarningCode,
  customerImportRowError,
  customerImportRowStatus,
  customerImportRow,
  customerImportTemplate,
  previewCustomerImportInput,
  customerImportRowsCursor,
  customerImportRowsQuery,
  customerImportPreview,
  customerImportRowsPage,
  customerImportCommitErrorCode,
  customerImportStatus,
  commitCustomerImportInput,
  customerImportCommitAccepted,
];

export type CustomerImportColumn = z.infer<typeof customerImportColumn>;
export type CustomerImportErrorCode = z.infer<typeof customerImportErrorCode>;
export type CustomerImportWarningCode = z.infer<typeof customerImportWarningCode>;
export type CustomerImportRowError = z.infer<typeof customerImportRowError>;
export type CustomerImportRow = z.infer<typeof customerImportRow>;
export type CustomerImportTemplate = z.infer<typeof customerImportTemplate>;
export type PreviewCustomerImportInput = z.infer<typeof previewCustomerImportInput>;
export type CustomerImportRowsQuery = z.infer<typeof customerImportRowsQuery>;
export type CustomerImportPreview = z.infer<typeof customerImportPreview>;
export type CustomerImportRowsPage = z.infer<typeof customerImportRowsPage>;
export type CustomerImportStatus = z.infer<typeof customerImportStatus>;
export type CommitCustomerImportInput = z.infer<typeof commitCustomerImportInput>;
export type CustomerImportCommitAccepted = z.infer<typeof customerImportCommitAccepted>;

export const customerImportCommitRequested = z.strictObject({ preview_id: id });
export const customerImportCommitJob = z.strictObject({ companyId: id, previewId: id });
export type CustomerImportCommitRequested = z.infer<typeof customerImportCommitRequested>;
export type CustomerImportCommitJob = z.infer<typeof customerImportCommitJob>;
