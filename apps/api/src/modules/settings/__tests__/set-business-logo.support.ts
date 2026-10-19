import { errorEnvelope } from '@pospay/contracts';
import { expect } from 'vitest';

import type { PermissionFixture } from '../../../../test/permissions-fixture.ts';

export interface LogoFilePatch {
  readonly companyId?: string;
  readonly businessId?: string;
  readonly branchId?: string | null;
  readonly ownerModule?: string;
  readonly ownerEntityId?: string;
  readonly contentType?: string;
  readonly requiredPermission?: string;
  readonly createdBy?: string;
  readonly status?: 'PENDING' | 'VERIFYING' | 'READY' | 'REJECTED';
  readonly purgeStarted?: boolean;
  readonly purged?: boolean;
}

export interface LogoReply {
  readonly statusCode: number;
  json: () => unknown;
}

export async function insertLogoFile(
  f: PermissionFixture,
  patch: LogoFilePatch = {},
): Promise<string> {
  const id = f.ids.newId();
  const businessId = patch.businessId ?? f.business;
  const status = patch.status ?? 'READY';
  const at = new Date('2026-10-10T12:00:00Z');
  await f.h.owner`INSERT INTO file_objects(
      company_id, id, business_id, branch_id, owner_module, owner_entity_id, staging_key, storage_key,
      content_type, size_bytes, required_permission, created_by, created_at, status, purge_started_at, purged_at)
    VALUES (
      ${patch.companyId ?? f.company}, ${id}, ${businessId}, ${patch.branchId ?? null},
      ${patch.ownerModule ?? 'settings'}, ${patch.ownerEntityId ?? businessId}, ${`staging-${id}`},
      ${status === 'READY' ? `storage-${id}` : null}, ${patch.contentType ?? 'image/png'}, 10,
      ${patch.requiredPermission ?? 'manage:business-identity:business'}, ${patch.createdBy ?? f.userId}, ${at}, ${status},
      ${patch.purgeStarted === true ? at : null}, ${patch.purged === true ? at : null})`;
  return id;
}

export function logoAudits(f: PermissionFixture, businessId = f.business) {
  return f.h.owner`SELECT actor_user_id, before, after FROM audit_log
    WHERE company_id = ${f.company} AND entity = 'business_settings'
      AND entity_id = ${businessId} AND action = 'settings.identity_changed'
    ORDER BY id`;
}

export function logoEvents(f: PermissionFixture, businessId = f.business) {
  return f.h.owner`SELECT payload FROM outbox
    WHERE company_id = ${f.company} AND aggregate_id = ${businessId}
      AND event_type = 'BusinessLogoChanged'
    ORDER BY seq`;
}

export async function foreignBusinessId(f: PermissionFixture): Promise<string> {
  const [row] = await f.h.owner`SELECT business_id FROM branches
    WHERE company_id = ${f.otherCompany} AND id = ${f.foreignBranch}`;
  return row?.['business_id'] as string;
}

export async function expectLogoRefusal(
  f: PermissionFixture,
  send: (body: { file_id: string }) => Promise<LogoReply>,
  patch: LogoFilePatch,
  expected: [number, string] = [404, 'FILE_NOT_FOUND'],
): Promise<void> {
  const id = await insertLogoFile(f, patch);
  const res = await send({ file_id: id });
  expect([res.statusCode, errorEnvelope.parse(res.json()).code]).toEqual(expected);
}

export async function deviceToken(f: PermissionFixture): Promise<string> {
  const code = await f.h.send('POST', `/v1/branches/${f.branch}/devices/pairing-code`, {
    cookie: f.cookie,
    company: f.company,
  });
  expect(code.status).toBe(201);
  const registered = await f.h.app.inject({
    method: 'POST',
    url: '/v1/devices/register',
    payload: { pairing_code: code.body['code'], label: 'Synthetic logo refusal' },
  });
  expect(registered.statusCode).toBe(201);
  const device = registered.json<{ company_id: string; device_id: string; claim_secret: string }>();
  const approved = await f.h.send(
    'POST',
    `/v1/branches/${f.branch}/devices/${device.device_id}/approve`,
    { cookie: f.cookie, company: f.company },
  );
  expect(approved.status).toBe(204);
  const claimed = await f.h.app.inject({
    method: 'POST',
    url: '/v1/devices/claim',
    payload: device,
  });
  expect(claimed.statusCode).toBe(200);
  return claimed.json<{ device_token: string }>().device_token;
}
