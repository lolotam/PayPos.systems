import { appendAuditLog, type IdGenerator, type TenantWrappers, type Tx } from '@pospay/db';
import { sql } from 'drizzle-orm';

import {
  CustomerImportCommitError,
  requireCustomerImportRequestLive,
  type CustomerImportCommitPreview,
  type CustomerImportCommitRow,
} from '../domain/customer-import-commit.ts';
import type { CustomerImportCommitTransactions } from '../ports/customer-import-commit.port.ts';

const STALE_PAGE_SIZE = 50;

type PreviewRow = {
  id: string;
  business_id: string;
  created_by: string;
  requested_at: Date | string | null;
  expires_at: Date | string;
  error_count: number;
  rows: unknown;
};

type CreatedCustomer = { id: string; name: string; locale: string; opted_out_at: Date | string | null };
type ExistingCustomer = {
  id: string;
  birth_month: number | null;
  birth_day: number | null;
  birth_year: number | null;
  gender: string | null;
  email: string | null;
};

const asIso = (value: Date | string): string =>
  value instanceof Date ? value.toISOString() : new Date(value).toISOString();

function parsePreview(row: PreviewRow): CustomerImportCommitPreview {
  const rows = row.rows as readonly CustomerImportCommitRow[] | null;
  if (!Array.isArray(rows) || rows.some((entry) => typeof entry?.phone !== 'string'))
    throw new CustomerImportCommitError('IMPORT_COMMIT_FAILED');
  return {
    id: row.id,
    business_id: row.business_id,
    created_by: row.created_by,
    requested_at: row.requested_at === null ? null : asIso(row.requested_at),
    expires_at: asIso(row.expires_at),
    error_count: Number(row.error_count),
    rows,
  };
}

async function lockPreview(
  tx: Tx,
  companyId: string,
  previewId: string,
): Promise<CustomerImportCommitPreview | null> {
  const [row] = await tx.execute<PreviewRow>(sql`SELECT id,business_id,created_by,requested_at,expires_at,error_count,rows
    FROM import_previews WHERE company_id=${companyId} AND id=${previewId} AND entity='customers'
      AND status='commit_requested' FOR UPDATE`);
  return row === undefined ? null : parsePreview(row);
}

async function insertNote(
  tx: Tx,
  companyId: string,
  businessId: string,
  customerId: string,
  note: string,
  at: string,
): Promise<void> {
  await tx.execute(sql`INSERT INTO customer_notes (company_id,customer_id,business_id,note,created_at)
    VALUES (${companyId},${customerId},${businessId},${note},${at})
    ON CONFLICT (company_id,customer_id,business_id) DO NOTHING`);
}

async function fillExistingCustomer(
  tx: Tx,
  companyId: string,
  businessId: string,
  row: CustomerImportCommitRow,
  at: string,
): Promise<void> {
  const [existing] =
    await tx.execute<ExistingCustomer>(sql`SELECT id,birth_month,birth_day,birth_year,gender,email
      FROM customers WHERE company_id=${companyId} AND phone=${row.phone} FOR UPDATE`);
  if (existing === undefined) throw new CustomerImportCommitError('IMPORT_COMMIT_FAILED');
  const b = row.birthday;
  const fillBirthday =
    b !== null && existing.birth_month === null && existing.birth_day === null && existing.birth_year === null;
  const fillGender = existing.gender === null && row.gender !== null;
  const fillEmail = existing.email === null && row.email !== null;
  if (fillBirthday || fillGender || fillEmail)
    await tx.execute(sql`UPDATE customers SET
      birth_month=${fillBirthday ? (b?.month ?? null) : existing.birth_month},
      birth_day=${fillBirthday ? (b?.day ?? null) : existing.birth_day},
      birth_year=${fillBirthday ? (b?.year ?? null) : existing.birth_year},
      gender=${fillGender ? row.gender : existing.gender},
      email=${fillEmail ? row.email : existing.email},
      updated_at=${at}
      WHERE company_id=${companyId} AND id=${existing.id}`);
  if (row.note !== null) await insertNote(tx, companyId, businessId, existing.id, row.note, at);
}

async function commitPreview(
  tx: Tx,
  ids: IdGenerator,
  companyId: string,
  preview: CustomerImportCommitPreview,
  at: string,
): Promise<void> {
  await tx.execute(sql`SELECT set_config('app.user_id', ${preview.created_by}, true)`);
  await tx.execute(
    sql`SELECT pg_advisory_xact_lock(hashtextextended(${`${companyId}:customer-import`}, 0))`,
  );
  const biz = await tx.execute<{ present: number }>(
    sql`SELECT 1 AS present FROM businesses WHERE company_id=${companyId} AND id=${preview.business_id} LIMIT 1`,
  );
  if (biz.length === 0) throw new CustomerImportCommitError('IMPORT_COMMIT_FAILED');
  if (preview.error_count !== 0) throw new CustomerImportCommitError('IMPORT_PREVIEW_HAS_ERRORS');
  requireCustomerImportRequestLive(preview);
  let createdCount = 0;
  for (const row of preview.rows) {
    const [created] =
      row.gender === null
        ? []
        : await tx.execute<CreatedCustomer>(sql`INSERT INTO customers
            (company_id,id,name,phone,locale,opted_out_at,birth_month,birth_day,birth_year,gender,email,created_at,updated_at)
            VALUES (${companyId},${ids.newId()},${row.name},${row.phone},${row.locale},${row.no_rating ? at : null},
              ${row.birthday?.month ?? null},${row.birthday?.day ?? null},${row.birthday?.year ?? null},
              ${row.gender},${row.email},${at},${at})
            ON CONFLICT (company_id,phone) DO NOTHING RETURNING id,name,locale,opted_out_at`);
    if (created === undefined) {
      await fillExistingCustomer(tx, companyId, preview.business_id, row, at);
      continue;
    }
    createdCount += 1;
    if (row.note !== null)
      await insertNote(tx, companyId, preview.business_id, created.id, row.note, at);
    // التدقيق بيسجّل الهاتف المقنّع بس: الرقم الكامل ممنوع يظهر في أي سجل (R1).
    await appendAuditLog(tx, ids.newId(), {
      entity: 'customer',
      entityId: created.id,
      action: 'imported',
      after: {
        id: created.id,
        name: created.name,
        locale: created.locale,
        phone: row.masked_phone,
        opted_out_of_ratings: created.opted_out_at !== null,
      },
    });
  }
  await tx.execute(sql`UPDATE import_previews SET status='committed',committed_at=${at},created_count=${createdCount}
    WHERE company_id=${companyId} AND id=${preview.id} AND entity='customers'`);
}

function mapError(error: unknown): never {
  if (error instanceof CustomerImportCommitError) throw error;
  const cause = error instanceof Error && 'cause' in error ? error.cause : error;
  if (
    typeof cause === 'object' &&
    cause !== null &&
    'code' in cause &&
    ['23514', '23503'].includes(String(cause.code))
  )
    throw new CustomerImportCommitError('IMPORT_COMMIT_FAILED');
  // إخفاء تفاصيل خطأ Drizzle/PG حتى لا يتسرّب رقم هاتف أو بريد في رسالة الخطأ (CIM-06).
  throw new Error('CUSTOMER_IMPORT_COMMIT_PERSISTENCE_FAILED');
}

/** يبني معاملات تثبيت استيراد العملاء: القفل والتثبيت الذري وفشل الطلب في معاملة واحدة (073 D-4). */
export function customerImportCommitTransactions(
  database: Pick<TenantWrappers, 'withTenant'>,
  ids: IdGenerator,
): CustomerImportCommitTransactions {
  return {
    run: (companyId, previewId, at) =>
      database
        .withTenant(
          companyId,
          async (tx) => {
            const preview = await lockPreview(tx, companyId, previewId);
            if (preview !== null) await commitPreview(tx, ids, companyId, preview, at);
          },
          { timeoutMs: 15000 },
        )
        .catch(mapError),
    fail: async (companyId, previewId, code) => {
      await database.withTenant(companyId, async (tx) => {
        await tx.execute(sql`UPDATE import_previews SET status='failed',error_code=${code}
          WHERE company_id=${companyId} AND id=${previewId} AND entity='customers' AND status='commit_requested'`);
      });
    },
    failStalePage: (companyId, before) =>
      database.withTenant(companyId, async (tx) => {
        const rows = await tx.execute<{ id: string }>(sql`
          WITH candidates AS MATERIALIZED (
            SELECT id FROM import_previews
            WHERE company_id=${companyId} AND entity='customers' AND status='commit_requested'
              AND requested_at <= ${new Date(before).toISOString()}
            ORDER BY requested_at, id LIMIT ${STALE_PAGE_SIZE} FOR UPDATE SKIP LOCKED
          )
          UPDATE import_previews p SET status='failed', error_code='IMPORT_COMMIT_FAILED'
          FROM candidates
          WHERE p.company_id=${companyId} AND p.id=candidates.id AND p.entity='customers'
            AND p.status='commit_requested'
          RETURNING p.id`);
        return rows.length;
      }),
  };
}
