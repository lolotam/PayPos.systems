import { createHash } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { packageImportCommitAccepted, packageImportCommitRequested } from '@pospay/contracts';
import { createPackageImportCommitTransactions } from '../persistence/package-import-commit.transactions.ts';
import { CommitPackageImportUseCase } from '../use-cases/commit-package-import/commit-package-import.usecase.ts';
import {
  packagePreviewRequestFixture,
  type PackagePreviewRequestFixture,
} from './package-preview-request.fixture.ts';
import {
  commitState,
  commitUseCase,
  postCommit,
  readyPreview,
  readyPreviewWithErrors,
} from './package-import-commit.fixture.ts';

let f: PackagePreviewRequestFixture;
beforeAll(async () => {
  f = await packagePreviewRequestFixture();
});
afterAll(async () => {
  await f?.close();
});
const command = (previewId: string, key = `key-${previewId}`) => ({
  companyId: f.companyId,
  userId: f.userId,
  businessId: f.businessId,
  previewId,
  key,
  fingerprint: createHash('sha256').update(`${key}:${previewId}`).digest('hex'),
});

// مستخدم ثانٍ بعضوية وإذن استيراد على النشاط الأول، ليصل الرفض إلى فحص الملكية لا إلى فحص الإذن.
async function secondImporter(): Promise<string> {
  await f.h.signedInOperator('commit-second-importer@example.test');
  const [user] = await f.h
    .owner`SELECT id FROM "user" WHERE email='commit-second-importer@example.test'`;
  const userId = user?.['id'] as string;
  const roleId = f.ids.newId();
  const membershipId = f.ids.newId();
  await f.h
    .owner`INSERT INTO roles(id,company_id,code,name_en) VALUES (${roleId},${f.companyId},'second_importer','Second importer')`;
  await f.h
    .owner`INSERT INTO memberships(company_id,id,user_id,role_id,role_owner_key,scope_type,scope_id)
    VALUES (${f.companyId},${membershipId},${userId},${roleId},${f.companyId},'COMPANY',${f.companyId})`;
  await f.h.owner`INSERT INTO permission_overrides
    (company_id,id,membership_id,permission_code,effect,scope_type,scope_id,reason,granted_by)
    VALUES (${f.companyId},${f.ids.newId()},${membershipId},'import:packages:business','ALLOW','BUSINESS',${f.businessId},'Synthetic test grant',${userId})`;
  return userId;
}

// يمنح المستخدم إذن الاستيراد على نشاط إضافي بنفس عضويته.
async function grantImport(userId: string, businessId: string): Promise<void> {
  await f.h.owner`INSERT INTO permission_overrides
    (company_id,id,membership_id,permission_code,effect,scope_type,scope_id,reason,granted_by)
    VALUES (${f.companyId},${f.ids.newId()},${f.membershipId},'import:packages:business','ALLOW','BUSINESS',${businessId},'Synthetic test grant',${userId})`;
}

describe('accepting a commit request', () => {
  it('answers 202, freezes the accepting membership and writes one id-only event in the same transaction', async () => {
    const id = await readyPreview(f);
    const response = await postCommit(f, id.toUpperCase(), 'accept-1');
    expect(response.statusCode).toBe(202);
    expect(packageImportCommitAccepted.parse(response.json())).toEqual({ preview_id: id });
    const { preview, events } = await commitState(f, id);
    expect(preview).toMatchObject({
      status: 'commit_requested',
      commit_membership_id: f.membershipId,
    });
    expect(preview?.['requested_at']).not.toBeNull();
    expect(events).toEqual([
      { event_type: 'PackageImportCommitRequested', payload: { preview_id: id } },
    ]);
    expect(packageImportCommitRequested.parse(events[0]?.['payload'])).toEqual({ preview_id: id });
    expect(
      await f.h.owner`SELECT id FROM package_entitlements WHERE company_id=${f.companyId}`,
    ).toEqual([]);
  });

  it('freezes the membership that grants the permission even when another covering membership sorts first', async () => {
    const roleId = f.ids.newId();
    const lowerId = '00000000-0000-7000-8000-000000000001';
    await f.h
      .owner`INSERT INTO roles(id,company_id,code,name_en) VALUES (${roleId},${f.companyId},'plain_member','Plain member')`;
    await f.h
      .owner`INSERT INTO memberships(company_id,id,user_id,role_id,role_owner_key,scope_type,scope_id)
      VALUES (${f.companyId},${lowerId},${f.userId},${roleId},${f.companyId},'BUSINESS',${f.businessId})`;
    const id = await readyPreview(f);
    expect((await postCommit(f, id, 'membership-1')).statusCode).toBe(202);
    expect((await commitState(f, id)).preview).toMatchObject({
      commit_membership_id: f.membershipId,
    });
  });

  it('replays the stored answer for the same key and refuses the same key for another request', async () => {
    const id = await readyPreview(f);
    const other = await readyPreview(f);
    const first = await postCommit(f, id, 'replay-1');
    const replay = await postCommit(f, id, 'replay-1');
    expect(replay.statusCode).toBe(202);
    expect(replay.json()).toEqual(first.json());
    expect((await commitState(f, id)).events).toHaveLength(1);
    const reused = await postCommit(f, other, 'replay-1');
    expect(reused.statusCode).toBe(422);
    expect(reused.json()).toMatchObject({ code: 'IDEMPOTENCY_KEY_REUSED' });
    expect((await commitState(f, other)).preview).toMatchObject({ status: 'ready' });
    expect((await commitState(f, other)).events).toEqual([]);
  });

  it('requires a valid Idempotency-Key before any work', async () => {
    const id = await readyPreview(f);
    const response = await postCommit(f, id, null);
    expect(response.statusCode).toBe(400);
    expect((await commitState(f, id)).preview).toMatchObject({ status: 'ready' });
  });
});

describe('repeating a commit request', () => {
  it('answers repeat commits and template downloads at once while the worker holds preview and membership FK locks', async () => {
    const id = await readyPreview(f);
    expect((await postCommit(f, id, 'busy-1')).statusCode).toBe(202);
    let elapsed = Infinity;
    await f.h.owner.begin(async (worker) => {
      await worker`SELECT id FROM import_previews WHERE company_id=${f.companyId} AND id=${id} FOR UPDATE`;
      await worker`SELECT id FROM memberships WHERE company_id=${f.companyId} AND id=${f.membershipId} FOR KEY SHARE`;
      const start = performance.now();
      const repeat = await postCommit(f, id, 'busy-2');
      const template = await f.h.app.inject({
        method: 'GET',
        url: `/v1/businesses/${f.businessId}/packages/import/template`,
        headers: f.headers,
      });
      elapsed = performance.now() - start;
      expect(repeat.statusCode).toBe(202);
      expect(repeat.json()).toEqual({ preview_id: id });
      expect(template.statusCode).toBe(200);
    });
    expect(elapsed).toBeLessThan(2_000);
    expect((await commitState(f, id)).events).toHaveLength(1);
  });

  it.each(['commit_requested', 'committed'] as const)(
    'repeats a %s preview with a fresh key: same 202 answer, no update and no second event',
    async (status) => {
      const id = await readyPreview(f);
      expect((await postCommit(f, id, `once-${status}`)).statusCode).toBe(202);
      if (status === 'committed')
        await f.database.withTenant(f.companyId, (tx) =>
          tx.execute(
            sql`UPDATE import_previews SET status='committed',committed_at=now(),created_count=0 WHERE id=${id}`,
          ),
        );
      const before = await commitState(f, id);
      const again = await postCommit(f, id, `again-${status}`);
      expect(again.statusCode).toBe(202);
      expect(again.json()).toEqual({ preview_id: id });
      const after = await commitState(f, id);
      expect(after.events).toHaveLength(1);
      expect(after.preview).toEqual(before.preview);
    },
  );
});

describe('refusing a commit request', () => {
  it.each([
    ['has errors', 409, 'IMPORT_PREVIEW_HAS_ERRORS'],
    ['pending', 409, 'IMPORT_FILE_NOT_READY'],
    ['failed', 422, 'IMPORT_COMMIT_FAILED'],
  ] as const)('refuses a preview that %s without writing', async (kind, status, code) => {
    const id =
      kind === 'has errors'
        ? await readyPreviewWithErrors(f)
        : (await f.useCase.execute(f.command(await f.upload()))).preview_id;
    if (kind === 'failed')
      await f.database.withTenant(f.companyId, (tx) =>
        tx.execute(
          sql`UPDATE import_previews SET status='failed',error_code='STORAGE_UNAVAILABLE' WHERE id=${id}`,
        ),
      );
    const before = await commitState(f, id);
    const response = await postCommit(f, id, `refuse-${kind.replace(' ', '-')}`);
    expect(response.statusCode).toBe(status);
    expect(response.json()).toMatchObject({ code });
    expect(await commitState(f, id)).toEqual(before);
  });

  it('refuses an expired preview at the injected instant', async () => {
    const id = await readyPreview(f);
    const later = commitUseCase(f, () => new Date(Date.now() + 3 * 86_400_000));
    await expect(later.execute(command(id, 'expired-1'))).rejects.toMatchObject({
      code: 'IMPORT_PREVIEW_EXPIRED',
    });
    expect((await commitState(f, id)).preview).toMatchObject({
      status: 'ready',
      commit_membership_id: null,
    });
    expect((await commitState(f, id)).events).toEqual([]);
  });
});

describe('refusing a commit request from the wrong caller', () => {
  it('uses 404 for an unknown preview, another creator and another business', async () => {
    const id = await readyPreview(f);
    const unknown = await postCommit(f, f.ids.newId(), 'unknown-1');
    expect(unknown.statusCode).toBe(404);
    expect(unknown.json()).toMatchObject({ code: 'IMPORT_PREVIEW_NOT_FOUND' });
    const useCase = commitUseCase(f, () => new Date());
    const second = await secondImporter();
    await expect(
      useCase.execute({ ...command(id, 'creator-1'), userId: second }),
    ).rejects.toMatchObject({ code: 'IMPORT_PREVIEW_NOT_FOUND' });
    await grantImport(f.userId, f.otherBusinessId);
    await expect(
      useCase.execute({ ...command(id, 'business-1'), businessId: f.otherBusinessId }),
    ).rejects.toMatchObject({ code: 'IMPORT_PREVIEW_NOT_FOUND' });
    expect(await commitState(f, id)).toMatchObject({ events: [] });
  });

  it('refuses an actor whose company does not own the business, without writing', async () => {
    const id = await readyPreview(f);
    const foreign = await f.h.signedInOperator('commit-foreign-actor@example.test');
    const foreignCompany = await f.h.onboard(foreign, 'Synthetic second foreign company');
    await expect(
      commitUseCase(f, () => new Date()).execute({
        ...command(id, 'company-1'),
        companyId: foreignCompany,
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(await commitState(f, id)).toMatchObject({ preview: { status: 'ready' }, events: [] });
  });

  it('refuses revoked permission and disabled orders at acceptance, with nothing written', async () => {
    const id = await readyPreview(f);
    const useCase = commitUseCase(f, () => new Date());
    await f.h
      .owner`UPDATE permission_overrides SET effect='DENY' WHERE company_id=${f.companyId} AND permission_code='import:packages:business'`;
    try {
      await expect(useCase.execute(command(id, 'deny-1'))).rejects.toMatchObject({
        code: 'FORBIDDEN',
      });
      expect((await postCommit(f, id, 'deny-2')).statusCode).toBe(403);
    } finally {
      await f.h
        .owner`UPDATE permission_overrides SET effect='ALLOW' WHERE company_id=${f.companyId} AND permission_code='import:packages:business'`;
    }
    await f.h
      .owner`INSERT INTO company_feature_overrides(company_id,flag,enabled,reason,set_by) VALUES (${f.companyId},'orders',false,'Synthetic test',${f.userId})`;
    try {
      await expect(useCase.execute(command(id, 'feature-1'))).rejects.toMatchObject({
        code: 'FEATURE_DISABLED',
      });
    } finally {
      await f.h
        .owner`DELETE FROM company_feature_overrides WHERE company_id=${f.companyId} AND flag='orders'`;
    }
    expect(await commitState(f, id)).toMatchObject({ preview: { status: 'ready' }, events: [] });
  });
});

describe('atomicity and cost', () => {
  it('rolls the status change back when the outbox insert fails, then succeeds on retry', async () => {
    const id = await readyPreview(f);
    const duplicateEvent = f.ids.newId();
    await f.database.withTenant(f.companyId, (tx) =>
      tx.execute(sql`INSERT INTO outbox(company_id,id,aggregate_type,aggregate_id,event_type,payload)
        VALUES (${f.companyId},${duplicateEvent},'test',${id},'TestEvent','{}'::jsonb)`),
    );
    const failing = new CommitPackageImportUseCase(
      createPackageImportCommitTransactions(f.database, { newId: () => duplicateEvent }),
      { now: () => new Date() },
    );
    await expect(failing.execute(command(id, 'rollback-1'))).rejects.toThrow();
    expect((await commitState(f, id)).preview).toMatchObject({
      status: 'ready',
      requested_at: null,
      commit_membership_id: null,
    });
    expect((await commitState(f, id)).events).toEqual([]);
    expect((await postCommit(f, id, 'rollback-1')).statusCode).toBe(202);
  });
});
