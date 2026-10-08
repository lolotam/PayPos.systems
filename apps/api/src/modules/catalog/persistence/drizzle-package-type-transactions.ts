import { appendAuditLog, type IdGenerator, type TenantWrappers, type Tx } from '@pospay/db';
import { sql } from 'drizzle-orm';
import { PackageTypeError } from '../domain/errors.ts';
import {
  packageTypeSnapshot,
  packageTypeTerms,
  type PackageService,
  type PackageTypeRecord,
} from '../domain/package-type.ts';
import type { PackageTypeTransactions } from '../ports/package-type-transactions.port.ts';

type Row = Omit<PackageTypeRecord, 'price' | 'created_at' | 'updated_at'> & {
  price: string;
  created_at: Date;
  updated_at: Date;
};

async function replaceComponents(
  tx: Tx,
  companyId: string,
  record: PackageTypeRecord,
  ids: IdGenerator,
) {
  const components = record.components.map((component) => ({ ...component, id: ids.newId() }));
  await tx.execute(sql`INSERT INTO package_type_components
    (company_id,id,business_id,package_type_id,service_id,sessions,position)
    SELECT ${companyId},(component->>'id')::uuid,${record.business_id},${record.id},
      (component->>'service_id')::uuid,(component->>'sessions')::integer,ordinality::smallint
    FROM jsonb_array_elements(${JSON.stringify(components)}::jsonb) WITH ORDINALITY AS x(component,ordinality)`);
}

async function insert(tx: Tx, companyId: string, record: PackageTypeRecord, ids: IdGenerator) {
  const view = packageTypeSnapshot(record);
  await tx.execute(sql`INSERT INTO package_types
    (company_id,id,business_id,name_en,name_ar,price,validity_days,revision,created_at,updated_at)
    VALUES (${companyId},${record.id},${record.business_id},${record.name_en},${record.name_ar},
      ${view.price},${record.validity_days},${record.revision},${record.created_at},${record.updated_at})`);
  await replaceComponents(tx, companyId, record, ids);
}

async function load(
  tx: Tx,
  companyId: string,
  businessId: string,
  packageTypeId: string,
): Promise<PackageTypeRecord | null> {
  const [row] = await tx.execute<Row>(sql`SELECT id,business_id,name_en,name_ar,price,validity_days,
    revision,created_at,updated_at FROM package_types
    WHERE company_id=${companyId} AND business_id=${businessId} AND id=${packageTypeId} FOR UPDATE`);
  if (row === undefined) return null;
  const components = await tx.execute<{ service_id: string; sessions: number }>(sql`
    SELECT service_id,sessions FROM package_type_components
    WHERE company_id=${companyId} AND business_id=${businessId} AND package_type_id=${packageTypeId}
    ORDER BY position`);
  return {
    ...row,
    ...packageTypeTerms({ ...row, components }),
    created_at: new Date(row.created_at).toISOString(),
    updated_at: new Date(row.updated_at).toISOString(),
  };
}

async function save(
  tx: Tx,
  companyId: string,
  before: PackageTypeRecord,
  after: PackageTypeRecord,
  ids: IdGenerator,
) {
  const view = packageTypeSnapshot(after);
  const rows =
    await tx.execute(sql`UPDATE package_types SET name_en=${after.name_en},name_ar=${after.name_ar},
    price=${view.price},validity_days=${after.validity_days},revision=${after.revision},updated_at=${after.updated_at}
    WHERE company_id=${companyId} AND business_id=${before.business_id} AND id=${before.id}
      AND revision=${before.revision} RETURNING id`);
  if (rows.length === 0) throw new PackageTypeError('PACKAGE_TYPE_REVISION_CONFLICT');
  await tx.execute(sql`DELETE FROM package_type_components WHERE company_id=${companyId}
    AND business_id=${before.business_id} AND package_type_id=${before.id}`);
  await replaceComponents(tx, companyId, after, ids);
}

function cleanError(error: unknown): never {
  if (error instanceof PackageTypeError) throw error;
  const cause = error instanceof Error && 'cause' in error ? error.cause : error;
  if (typeof cause === 'object' && cause !== null && 'code' in cause) {
    const constraint = 'constraint_name' in cause ? String(cause.constraint_name) : '';
    if (
      cause.code === '23505' &&
      ['package_types_name_en_key', 'package_types_name_ar_key'].includes(constraint)
    )
      throw new PackageTypeError('PACKAGE_TYPE_NAME_TAKEN');
    if (cause.code === '40P01' || cause.code === '40001')
      throw new PackageTypeError('TRANSACTION_RETRY_REQUIRED');
    if (cause.code === '23503')
      throw new PackageTypeError(
        constraint === 'package_type_components_service_fk'
          ? 'PACKAGE_TYPE_SERVICE_NOT_FOUND'
          : 'PACKAGE_TYPE_NOT_FOUND',
      );
    if (cause.code === '23514' && constraint.startsWith('package_types_name_'))
      throw new PackageTypeError('PACKAGE_TYPE_NAME_INVALID');
  }
  throw new Error('PACKAGE_TYPE_PERSISTENCE_FAILED');
}

export function createPackageTypeTransactions(
  database: TenantWrappers,
  ids: IdGenerator,
): PackageTypeTransactions {
  return {
    run: async ({ companyId, userId }, work) => {
      try {
        return await database.withTenant(
          companyId,
          (tx) =>
            work({
              insert: (record) => insert(tx, companyId, record, ids),
              load: (businessId, typeId) => load(tx, companyId, businessId, typeId),
              services: async (businessId, serviceIds) =>
                Array.from(
                  await tx.execute<PackageService & Record<string, unknown>>(sql`
            SELECT id AS service_id,name_en,name_ar,price FROM services WHERE company_id=${companyId}
            AND business_id=${businessId} AND id IN (${sql.join(
              serviceIds.map((id) => sql`${id}::uuid`),
              sql`,`,
            )})
            ORDER BY id FOR SHARE`),
                ),
              save: (before, after) => save(tx, companyId, before, after, ids),
              audit: (before, after) =>
                appendAuditLog(tx, ids.newId(), {
                  entity: 'package_type',
                  entityId: after.id,
                  action: before === null ? 'created' : 'updated',
                  ...(before === null ? {} : { before: packageTypeSnapshot(before) }),
                  after: packageTypeSnapshot(after),
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
