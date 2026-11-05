import { createDatabase } from '@pospay/db';
import { systemUuidV7 } from '@pospay/ids';
import { readFileSync } from 'node:fs';
import { startHarness } from '../../../../test/harness.ts';
import { PackageImportPreviewController } from '../http/package-import-preview.controller.ts';
import { createPackageImportRequestTransactions } from '../persistence/package-import-request.transactions.ts';
import { RequestPackageImportPreviewUseCase } from '../use-cases/request-package-import-preview/request-package-import-preview.usecase.ts';

async function seedWorkspace(h: Awaited<ReturnType<typeof startHarness>>) {
  const ids = systemUuidV7();
  const ownerCookie = await h.signedInOperator('preview-owner@example.test');
  const cookie = await h.signedInOperator('preview-importer@example.test');
  const companyId = await h.onboard(ownerCookie, 'Synthetic preview company');
  const [user] = await h.owner`SELECT id FROM "user" WHERE email='preview-importer@example.test'`;
  if (user === undefined) throw new Error('Missing preview test importer');
  const userId = user['id'] as string;
  const roleId = ids.newId();
  const membershipId = ids.newId();
  await h.owner`INSERT INTO roles(id,company_id,code,name_en) VALUES (${roleId},${companyId},'preview_importer','Preview importer')`;
  await h.owner`INSERT INTO memberships(company_id,id,user_id,role_id,role_owner_key,scope_type,scope_id)
    VALUES (${companyId},${membershipId},${userId},${roleId},${companyId},'COMPANY',${companyId})`;
  const businessId = ids.newId();
  const otherBusinessId = ids.newId();
  for (const id of [businessId, otherBusinessId])
    await h.owner`INSERT INTO businesses(company_id,id,name_en,vertical_type)
    VALUES (${companyId},${id},'Synthetic import business','salon')`;
  for (const permission of ['import:packages:business', 'manage:employees:business'])
    await h.owner`INSERT INTO permission_overrides
    (company_id,id,membership_id,permission_code,effect,scope_type,scope_id,reason,granted_by)
    VALUES (${companyId},${ids.newId()},${membershipId},${permission},'ALLOW','BUSINESS',${businessId},'Synthetic test grant',${userId})`;
  return { companyId, userId, businessId, otherBusinessId, cookie, membershipId };
}

export async function packagePreviewRequestFixture(mount = true) {
  const h = await startHarness(mount ? { controllers: [PackageImportPreviewController] } : {});
  const draft = readFileSync(
    new URL(
      '../../../../../../docs/specs/058-packages-sell-redeem/47-1a-migration.draft.sql',
      import.meta.url,
    ),
    'utf8',
  );
  const [column] = await h.owner`SELECT EXISTS(SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='import_previews' AND column_name='skipped_count') AS present`;
  if (column?.['present'] !== true) {
    if (process.env['CI']) throw new Error('PACKAGE_PREVIEW_FINAL_MIGRATION_REQUIRED');
    await h.owner.unsafe(draft);
  }
  const [guard] =
    await h.owner`SELECT to_regprocedure('package_import_preview_update_guard()') IS NOT NULL AS present`;
  if (guard?.['present'] !== true) throw new Error('PACKAGE_PREVIEW_MIGRATION_GUARD_REQUIRED');
  const workspace = await seedWorkspace(h);
  const ids = systemUuidV7();
  const database = createDatabase({ url: h.urls.app, ids });
  const useCase = new RequestPackageImportPreviewUseCase(
    createPackageImportRequestTransactions(database, ids),
    ids,
    { now: () => new Date() },
  );
  return {
    h,
    ids,
    database,
    useCase,
    ...workspace,
    command: (fileId: string) => ({
      companyId: workspace.companyId,
      userId: workspace.userId,
      businessId: workspace.businessId,
      fileId,
    }),
    headers: { cookie: workspace.cookie, 'x-company-id': workspace.companyId },
    url: `/v1/businesses/${workspace.businessId}/packages/import/previews`,
    upload: () => uploadFacts(h, ids, workspace),
    close: async () => {
      await database.close();
      await h.close();
    },
  };
}

async function uploadFacts(
  h: Awaited<ReturnType<typeof startHarness>>,
  ids: ReturnType<typeof systemUuidV7>,
  actor: { companyId: string; userId: string; businessId: string },
) {
  const fileId = ids.newId();
  // No object bytes or storage capability exist in this fixture; acceptance can use facts only.
  await h.owner`INSERT INTO file_objects(company_id,id,business_id,owner_module,owner_entity_id,staging_key,storage_key,content_type,size_bytes,required_permission,created_by,created_at,status)
    VALUES (${actor.companyId},${fileId},${actor.businessId},'orders',${actor.businessId},${`staging/${fileId}`},${`verified/${fileId}`},
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',2097152,'read:files:business',${actor.userId},now(),'READY')`;
  return fileId;
}

export type PackagePreviewRequestFixture = Awaited<ReturnType<typeof packagePreviewRequestFixture>>;
