import { appendAuditLog, type IdGenerator, type TenantWrappers, type Tx } from '@pospay/db';
import { sql } from 'drizzle-orm';

import { ServiceCategoryError } from '../domain/errors.ts';
import {
  serviceCategoryBranchSettingSnapshot,
  type ServiceCategoryBranchSettingRecord,
} from '../domain/service-category-branch.ts';
import { serviceCategorySnapshot, type ServiceCategoryRecord } from '../domain/service-category.ts';
import type { ServiceCategoryTransactions } from '../ports/service-category-transactions.port.ts';

type Row = {
  id: string;
  business_id: string;
  name_en: string;
  name_ar: string;
  owner_branch_id: string | null;
  visibility: 'BUSINESS' | 'BRANCH';
  closed_at: Date | null;
  revision: number;
  created_at: Date;
  updated_at: Date;
};

type BranchSettingRow = {
  id: string;
  business_id: string;
  branch_id: string;
  category_id: string;
  state: 'ENABLED' | 'HIDDEN';
  revision: number;
  created_at: Date;
  updated_at: Date;
};

async function insert(tx: Tx, companyId: string, record: ServiceCategoryRecord): Promise<void> {
  await tx.execute(sql`INSERT INTO service_categories
    (company_id,id,business_id,name_en,name_ar,owner_branch_id,visibility,revision,created_at,updated_at)
    VALUES (${companyId},${record.id},${record.business_id},${record.name_en},${record.name_ar},
      ${record.owner_branch_id},${record.visibility},${record.revision},${record.created_at},${record.updated_at})`);
}

async function load(
  tx: Tx,
  companyId: string,
  businessId: string,
  categoryId: string,
  mode: 'update' | 'share' = 'update',
): Promise<ServiceCategoryRecord | null> {
  const lock = mode === 'share' ? sql`FOR SHARE` : sql`FOR UPDATE`;
  const [row] = await tx.execute<Row>(sql`SELECT id,business_id,name_en,name_ar,owner_branch_id,visibility,
    closed_at,revision,created_at,updated_at FROM service_categories
    WHERE company_id=${companyId} AND business_id=${businessId} AND id=${categoryId} ${lock}`);
  if (row === undefined) return null;
  return {
    id: row.id,
    business_id: row.business_id,
    name_en: row.name_en,
    name_ar: row.name_ar,
    owner_branch_id: row.owner_branch_id,
    visibility: row.visibility,
    closed_at: row.closed_at === null ? null : new Date(row.closed_at).toISOString(),
    revision: row.revision,
    created_at: new Date(row.created_at).toISOString(),
    updated_at: new Date(row.updated_at).toISOString(),
  };
}

async function branchBusiness(
  tx: Tx,
  companyId: string,
  branchId: string,
): Promise<string | null> {
  const [row] = await tx.execute<{ business_id: string }>(sql`
    SELECT business_id FROM branches WHERE company_id=${companyId} AND id=${branchId}`);
  return row?.business_id ?? null;
}

async function save(
  tx: Tx,
  companyId: string,
  before: ServiceCategoryRecord,
  after: ServiceCategoryRecord,
): Promise<void> {
  const rows = await tx.execute(sql`UPDATE service_categories
    SET name_en=${after.name_en},name_ar=${after.name_ar},visibility=${after.visibility},
      revision=${after.revision},updated_at=${after.updated_at}
    WHERE company_id=${companyId} AND business_id=${before.business_id} AND id=${before.id}
      AND revision=${before.revision} RETURNING id`);
  if (rows.length === 0) throw new ServiceCategoryError('SERVICE_CATEGORY_REVISION_CONFLICT');
}

async function loadBranchSetting(
  tx: Tx,
  companyId: string,
  businessId: string,
  branchId: string,
  categoryId: string,
): Promise<ServiceCategoryBranchSettingRecord | null> {
  const [row] = await tx.execute<BranchSettingRow>(sql`SELECT id,business_id,branch_id,category_id,
    state,revision,created_at,updated_at FROM service_category_branch_settings
    WHERE company_id=${companyId} AND business_id=${businessId} AND branch_id=${branchId}
      AND category_id=${categoryId} FOR UPDATE`);
  if (row === undefined) return null;
  return {
    id: row.id,
    business_id: row.business_id,
    branch_id: row.branch_id,
    category_id: row.category_id,
    state: row.state,
    revision: row.revision,
    created_at: new Date(row.created_at).toISOString(),
    updated_at: new Date(row.updated_at).toISOString(),
  };
}

async function insertBranchSetting(
  tx: Tx,
  companyId: string,
  record: ServiceCategoryBranchSettingRecord,
): Promise<void> {
  await tx.execute(sql`INSERT INTO service_category_branch_settings
    (company_id,id,business_id,branch_id,category_id,state,revision,created_at,updated_at)
    VALUES (${companyId},${record.id},${record.business_id},${record.branch_id},${record.category_id},
      ${record.state},${record.revision},${record.created_at},${record.updated_at})`);
}

async function saveBranchSetting(
  tx: Tx,
  companyId: string,
  before: ServiceCategoryBranchSettingRecord,
  after: ServiceCategoryBranchSettingRecord,
): Promise<void> {
  const rows = await tx.execute(sql`UPDATE service_category_branch_settings
    SET state=${after.state},revision=${after.revision},updated_at=${after.updated_at}
    WHERE company_id=${companyId} AND business_id=${before.business_id} AND branch_id=${before.branch_id}
      AND category_id=${before.category_id} AND revision=${before.revision} RETURNING id`);
  if (rows.length === 0) throw new ServiceCategoryError('SERVICE_CATEGORY_REVISION_CONFLICT');
}

function cleanError(error: unknown): never {
  if (error instanceof ServiceCategoryError) throw error;
  const cause = error instanceof Error && 'cause' in error ? error.cause : error;
  if (typeof cause === 'object' && cause !== null && 'code' in cause) {
    const constraint = 'constraint_name' in cause ? String(cause.constraint_name) : '';
    if (cause.code === '23505' && constraint === 'service_categories_business_name_uq')
      throw new ServiceCategoryError('SERVICE_CATEGORY_NAME_TAKEN');
    if (
      cause.code === '23505' &&
      constraint === 'service_category_branch_settings_branch_category_uq'
    )
      throw new ServiceCategoryError('SERVICE_CATEGORY_REVISION_CONFLICT');
    if (cause.code === '40P01' || cause.code === '40001')
      throw new ServiceCategoryError('TRANSACTION_RETRY_REQUIRED');
    if (
      cause.code === '23503' &&
      (constraint === 'service_categories_business_fk' ||
        constraint === 'service_categories_owner_branch_fk')
    )
      throw new ServiceCategoryError('SERVICE_CATEGORY_NOT_FOUND');
    if (cause.code === '23514' && constraint.startsWith('service_categories_name_'))
      throw new ServiceCategoryError('SERVICE_CATEGORY_NAME_INVALID');
    if (cause.code === '23514' && constraint === 'service_categories_branch_owner_required')
      throw new ServiceCategoryError('SERVICE_CATEGORY_VISIBILITY_FIXED');
  }
  throw new Error('SERVICE_CATEGORY_PERSISTENCE_FAILED');
}

export function createServiceCategoryTransactions(
  database: TenantWrappers,
  ids: IdGenerator,
): ServiceCategoryTransactions {
  return {
    run: async ({ companyId, userId }, work) => {
      try {
        return await database.withTenant(
          companyId,
          (tx) =>
            work({
              insert: (record) => insert(tx, companyId, record),
              load: (businessId, categoryId) => load(tx, companyId, businessId, categoryId),
              loadForShare: (businessId, categoryId) =>
                load(tx, companyId, businessId, categoryId, 'share'),
              loadBranchSetting: (businessId, branchId, categoryId) =>
                loadBranchSetting(tx, companyId, businessId, branchId, categoryId),
              branchBusiness: (branchId) => branchBusiness(tx, companyId, branchId),
              save: (before, after) => save(tx, companyId, before, after),
              audit: (before, after) =>
                appendAuditLog(tx, ids.newId(), {
                  entity: 'service_category',
                  entityId: after.id,
                  action: before === null ? 'created' : 'updated',
                  ...(before === null ? {} : { before: serviceCategorySnapshot(before) }),
                  after: serviceCategorySnapshot(after),
                }),
              insertBranchSetting: (record) => insertBranchSetting(tx, companyId, record),
              saveBranchSetting: (before, after) =>
                saveBranchSetting(tx, companyId, before, after),
              auditBranchSetting: (before, after) =>
                appendAuditLog(tx, ids.newId(), {
                  entity: 'service_category_branch_setting',
                  entityId: after.id,
                  action: before === null ? 'created' : 'updated',
                  ...(before === null
                    ? {}
                    : { before: serviceCategoryBranchSettingSnapshot(before) }),
                  after: serviceCategoryBranchSettingSnapshot(after),
                }),
            }),
          { userId },
        );
      } catch (error) {
        cleanError(error);
      }
    },
  };
}
