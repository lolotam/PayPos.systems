import { describe, expect, it } from 'vitest';
import { requestFileUpload, fileStatus, fileUploadTicket, fileDownloadByKey } from '../files.js';
import { buildOpenApiDocument } from '../openapi.js';
const uuid = '01920000-0000-7000-8000-000000000abc';
const input = {
  owner_module: 'staff',
  owner_entity_id: uuid,
  size_bytes: 10,
  content_type: 'application/pdf',
  required_permission: 'read:files:business',
};
describe('files contracts', () => {
  it('rejects a supplied key, unknown field, path injection, zero size and platform/own scope', () => {
    expect(requestFileUpload.safeParse(input).success).toBe(true);
    for (const patch of [
      { storage_key: 'client/key' },
      { owner_module: '../staff' },
      { size_bytes: 0 },
      { size_bytes: 1.1 },
      { required_permission: 'read:files:platform' },
      { required_permission: 'read:files:own' },
    ])
      expect(requestFileUpload.safeParse({ ...input, ...patch }).success).toBe(false);
  });
  it('requires exact expiry and publishes matching API statuses', () => {
    expect(
      fileUploadTicket.safeParse({
        id: uuid,
        upload_url: 'http://synthetic.invalid/',
        expires_in: 900,
        headers: { 'content-type': 'image/png', 'content-length': '10' },
      }).success,
    ).toBe(false);
    expect(
      fileStatus.safeParse({
        id: uuid,
        status: 'PENDING',
        size_bytes: 1,
        content_type: 'application/pdf',
      }).success,
    ).toBe(true);
    const paths = buildOpenApiDocument()['paths'] as Record<
      string,
      { post?: { responses: Record<string, unknown> } }
    >;
    expect(
      paths['/v1/businesses/{businessId}/files/uploads']?.post?.responses['201'],
    ).toBeDefined();
    expect(paths['/v1/files/{id}/confirm']?.post?.responses['202']).toBeDefined();
    expect(paths['/v1/files/{id}/download']?.post?.responses['200']).toBeDefined();
    expect(paths['/v1/files/download']?.post?.responses['200']).toBeDefined();
    expect(fileDownloadByKey.safeParse({ storage_key: 'synthetic-key' }).success).toBe(true);
    for (const body of [
      { storage_key: '' },
      { storage_key: 'x'.repeat(401) },
      { storage_key: 'synthetic-key', permission: 'forged' },
    ])
      expect(fileDownloadByKey.safeParse(body).success).toBe(false);
  });
});

it('owner policy contract permits the three types and exact 10 MiB boundary only', () => {
  for (const content_type of ['application/pdf', 'image/jpeg', 'image/png'])
    expect(
      requestFileUpload.safeParse({ ...input, content_type, size_bytes: 10 * 1024 * 1024 }).success,
    ).toBe(true);
  for (const patch of [
    { content_type: 'image/webp' },
    { content_type: 'text/plain' },
    { size_bytes: 10 * 1024 * 1024 + 1 },
  ])
    expect(requestFileUpload.safeParse({ ...input, ...patch }).success).toBe(false);
});
