import { z } from 'zod';
import { id } from './scalars/id.js';

export const requestFileUpload = z
  .strictObject({
    owner_module: z.string().regex(/^[a-z][a-z0-9-]{0,49}$/),
    owner_entity_id: id,
    branch_id: id.optional(),
    content_type: z.enum([
      'application/pdf',
      'image/jpeg',
      'image/png',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    ]),
    size_bytes: z
      .number()
      .int()
      .positive()
      .max(10 * 1024 * 1024),
    required_permission: z.string().regex(/^[a-z]+:[a-z-]+:(company|business|branch)$/),
  })
  .meta({ id: 'RequestFileUpload' });

export const fileUploadTicket = z
  .strictObject({
    id,
    upload_url: z.url(),
    expires_in: z.literal(120),
    headers: z.strictObject({ 'content-type': z.string(), 'content-length': z.string() }),
  })
  .meta({ id: 'FileUploadTicket' });

export const fileStatus = z
  .strictObject({
    id,
    status: z.enum(['PENDING', 'VERIFYING', 'READY', 'REJECTED']),
    content_type: z.string(),
    size_bytes: z.number().int().positive(),
    storage_key: z.string().optional(),
    rejection_code: z
      .enum(['FILE_TYPE_INVALID', 'FILE_SIZE_INVALID', 'FILE_CONTENT_INVALID'])
      .optional(),
  })
  .meta({ id: 'FileStatus' });
export const fileConfirmation = z
  .strictObject({ id, status: z.literal('QUEUED') })
  .meta({ id: 'FileConfirmation' });
export const fileDownload = z
  .strictObject({ download_url: z.url(), expires_in: z.literal(60) })
  .meta({ id: 'FileDownload' });
export const fileVerificationJob = z.strictObject({ companyId: id, fileId: id });
export type RequestFileUpload = z.infer<typeof requestFileUpload>;
export type FileStatus = z.infer<typeof fileStatus>;

export const fileDownloadByKey = z
  .strictObject({ storage_key: z.string().min(1).max(400) })
  .meta({ id: 'FileDownloadByKey' });

export const fileRetentionJob = z.strictObject({ companyId: id });
