import { systemUuidV7 } from '@pospay/ids';
import { sql } from 'drizzle-orm';
import postgres from 'postgres';

import type { Tx } from '../src/index.ts';
import { seedTwoTenants, TENANT } from './tenancy-fixtures.ts';

export { expectPgError } from './commission-statement-fixtures.ts';

export type RatingTarget = Tx | postgres.Sql | postgres.TransactionSql;

export interface RatingTenant {
  readonly company: string;
  readonly business: string;
  readonly branch: string;
  readonly customer: string;
  readonly employees: readonly [string, string];
}

export const RATING_TENANT = {
  A: {
    ...TENANT.A,
    customer: '01920000-0000-7000-8000-000000000aa1',
    employees: ['01920000-0000-7000-8000-000000000aa2', '01920000-0000-7000-8000-000000000aa3'],
  },
  B: {
    ...TENANT.B,
    customer: '01920000-0000-7000-8000-000000000bb1',
    employees: ['01920000-0000-7000-8000-000000000bb2', '01920000-0000-7000-8000-000000000bb3'],
  },
} as const satisfies Record<string, RatingTenant>;

export const OTHER_RATING_BUSINESS = {
  business: '01920000-0000-7000-8000-000000000cc1',
  branch: '01920000-0000-7000-8000-000000000cc2',
  employee: '01920000-0000-7000-8000-000000000cc3',
} as const;

const ids = systemUuidV7();
const SEED_TIME = '2026-01-01T00:00:00Z';

/**
 * بيحوّل أي وقت لـ ISO string؛ الـ Date object مش بيعدّي كمعامل في قوالب الـ sql، فكل تاريخ بيتبني نص.
 */
function toIso(value: Date | string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  return value instanceof Date ? value.toISOString() : value;
}

async function run(
  target: RatingTarget,
  text: string,
  parameters: unknown[] = [],
): Promise<Record<string, unknown>[]> {
  if (typeof target === 'function') {
    const rows = await target.unsafe(text, parameters as postgres.ParameterOrJSON<never>[]);
    return Array.from(rows);
  }
  const query = sql.empty();
  let offset = 0;
  for (const match of text.matchAll(/\$(\d+)/g)) {
    const position = match.index;
    query.append(sql.raw(text.slice(offset, position)));
    query.append(sql`${parameters[Number(match[1]) - 1]}`);
    offset = position + match[0].length;
  }
  query.append(sql.raw(text.slice(offset)));
  const rows = await target.execute(query);
  return Array.from(rows);
}

async function seedEmployee(
  owner: postgres.Sql,
  company: string,
  business: string,
  branch: string,
  employee: string,
  employeeNumber: number,
): Promise<void> {
  const name = `Synthetic employee ${employeeNumber}`;
  await owner`INSERT INTO employees(
    company_id,id,business_id,primary_branch_id,name_en,name_en_key,role_code,hire_date,employee_number)
    VALUES (${company},${employee},${business},${branch},${name},${name.toLowerCase()},'staff',
      '2026-01-01',${employeeNumber})`;
}

/** بيجهّز عميلاً وموظفين لكل شركة، ونشاطاً ثانياً داخل A لاختبارات المفاتيح المركبة. */
export async function seedRatingTenants(ownerUrl: string): Promise<void> {
  await seedTwoTenants(ownerUrl);
  const owner = postgres(ownerUrl, { max: 1, onnotice: () => undefined });
  try {
    for (const [tenantIndex, tenant] of [RATING_TENANT.A, RATING_TENANT.B].entries()) {
      await owner`INSERT INTO customers(company_id,id,name,phone,locale,created_at,updated_at)
        VALUES (${tenant.company},${tenant.customer},'Synthetic customer',${`+1000000000${tenantIndex + 1}`},
          'ar',${SEED_TIME},${SEED_TIME})`;
      for (const [employeeIndex, employee] of tenant.employees.entries()) {
        await seedEmployee(
          owner,
          tenant.company,
          tenant.business,
          tenant.branch,
          employee,
          tenantIndex * 2 + employeeIndex + 1,
        );
      }
    }
    const other = OTHER_RATING_BUSINESS;
    await owner`INSERT INTO businesses(company_id,id,vertical_type,name_en)
      VALUES(${RATING_TENANT.A.company},${other.business},'salon','Other synthetic business')`;
    await owner`INSERT INTO branches(company_id,id,business_id,name_en)
      VALUES(${RATING_TENANT.A.company},${other.branch},${other.business},'Other synthetic branch')`;
    await seedEmployee(
      owner,
      RATING_TENANT.A.company,
      other.business,
      other.branch,
      other.employee,
      3,
    );
  } finally {
    await owner.end();
  }
}

export interface InsertRequestOptions {
  readonly tenant: RatingTenant;
  readonly id?: string;
  readonly business?: string;
  readonly customer?: string;
  readonly branch?: string;
  readonly date?: string;
  readonly dueAt?: Date | string;
  readonly sendDeadline?: Date | string | null;
  readonly status?: string;
  readonly cancelReason?: string | null;
  readonly tokenHash?: Buffer | null;
  readonly tokenKeyVersion?: number | null;
  readonly expiresAt?: Date | string | null;
  readonly claimedAt?: Date | string | null;
  readonly readyEventId?: string | null;
  readonly sentAt?: Date | string | null;
  readonly consumedAt?: Date | string | null;
  readonly claimXactId?: string | null;
  readonly consumeXactId?: string | null;
}

export async function insertRequest(
  target: RatingTarget,
  options: InsertRequestOptions,
): Promise<string> {
  const { tenant } = options;
  const id = options.id ?? ids.newId();
  const claimedAt = toIso(
    options.claimedAt !== undefined
      ? options.claimedAt
      : options.tokenHash
        ? '2026-06-01T00:00:00Z'
        : null,
  );
  const expiresAt = toIso(
    options.expiresAt !== undefined
      ? options.expiresAt
      : options.tokenHash
        ? new Date(Date.parse(claimedAt as string) + 604_800_000).toISOString()
        : null,
  );
  const keyVersion =
    options.tokenKeyVersion !== undefined ? options.tokenKeyVersion : options.tokenHash ? 1 : null;
  const readyEventId =
    options.readyEventId !== undefined
      ? options.readyEventId
      : options.tokenHash
        ? ids.newId()
        : null;
  await run(
    target,
    `INSERT INTO rating_requests(company_id,id,business_id,customer_id,business_date,branch_id,due_at,
      send_deadline,status,cancel_reason,token_hash,token_key_version,expires_at,claimed_at,ready_event_id,
      sent_at,consumed_at,claim_xact_id,consume_xact_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)`,
    [
      tenant.company,
      id,
      options.business ?? tenant.business,
      options.customer ?? tenant.customer,
      options.date ?? '2026-06-01',
      options.branch ?? tenant.branch,
      toIso(options.dueAt) ?? '2026-06-01T01:00:00Z',
      toIso(options.sendDeadline),
      options.status ?? 'SCHEDULED',
      options.cancelReason ?? null,
      options.tokenHash ?? null,
      keyVersion,
      expiresAt,
      claimedAt,
      readyEventId,
      toIso(options.sentAt),
      toIso(options.consumedAt),
      options.claimXactId ?? null,
      options.consumeXactId ?? null,
    ],
  );
  return id;
}

export interface ClaimRequestOptions {
  readonly tenant: RatingTenant;
  readonly requestId: string;
  readonly tokenHash: Buffer;
  readonly readyEventId: string;
  readonly now: Date | string;
  readonly performers: readonly string[];
}

export async function claimRequest(target: Tx, options: ClaimRequestOptions): Promise<void> {
  const { tenant, requestId, tokenHash, readyEventId } = options;
  const now = toIso(options.now);
  await run(
    target,
    `UPDATE rating_requests SET status='SENDING',token_hash=$1,token_key_version=1,
      claimed_at=$2,expires_at=$2::timestamptz+interval '168 hours',ready_event_id=$3,updated_at=$2
     WHERE company_id=$4 AND id=$5`,
    [tokenHash, now, readyEventId, tenant.company, requestId],
  );
  for (const employee of options.performers) {
    await insertPerformer(target, { tenant, requestId, employeeId: employee });
  }
}

export async function insertPerformer(
  target: RatingTarget,
  options: {
    tenant: RatingTenant;
    requestId: string;
    employeeId: string;
    business?: string;
    id?: string;
  },
): Promise<string> {
  const id = options.id ?? ids.newId();
  await run(
    target,
    `INSERT INTO rating_performers(company_id,id,request_id,business_id,employee_id)
     VALUES ($1,$2,$3,$4,$5)`,
    [
      options.tenant.company,
      id,
      options.requestId,
      options.business ?? options.tenant.business,
      options.employeeId,
    ],
  );
  return id;
}

export interface InsertRatingOptions {
  readonly tenant: RatingTenant;
  readonly requestId: string;
  readonly stars: number;
  readonly comment?: string | null;
  readonly now: Date | string;
  readonly id?: string;
  readonly business?: string;
  readonly branch?: string;
}

export async function insertRating(
  target: RatingTarget,
  options: InsertRatingOptions,
): Promise<string> {
  const id = options.id ?? ids.newId();
  await run(
    target,
    `INSERT INTO ratings(company_id,id,request_id,business_id,branch_id,stars,comment,submitted_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [
      options.tenant.company,
      id,
      options.requestId,
      options.business ?? options.tenant.business,
      options.branch ?? options.tenant.branch,
      options.stars,
      options.comment ?? null,
      toIso(options.now),
    ],
  );
  return id;
}

export async function insertAttribution(
  target: RatingTarget,
  options: InsertRatingOptions & { readonly ratingId: string; readonly employeeId: string },
): Promise<string> {
  const id = ids.newId();
  await run(
    target,
    `INSERT INTO rating_attributions(company_id,id,rating_id,request_id,employee_id,business_id,
      branch_id,stars,submitted_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [
      options.tenant.company,
      id,
      options.ratingId,
      options.requestId,
      options.employeeId,
      options.business ?? options.tenant.business,
      options.branch ?? options.tenant.branch,
      options.stars,
      toIso(options.now),
    ],
  );
  return id;
}

export interface ConsumeRequestOptions {
  readonly tenant: RatingTenant;
  readonly tokenHash: Buffer;
  readonly now: string;
}

/**
 * بيستهلك رابط التقييم بست update ذرّي واحد؛ اللي رجع هو الطلب اللي اتستهلَك، أو null لو انتهت.
 */
export async function consumeRequest(
  target: RatingTarget,
  options: ConsumeRequestOptions,
): Promise<string | null> {
  const consumed = await run(
    target,
    `UPDATE rating_requests SET consumed_at=$1,updated_at=$1
     WHERE company_id=$2 AND token_hash=$3 AND consumed_at IS NULL AND expires_at>$1
     RETURNING id`,
    [options.now, options.tenant.company, options.tokenHash],
  );
  const request = consumed[0];
  return request === undefined ? null : (request['id'] as string);
}

export interface ConsumeRatingOptions extends InsertRatingOptions {
  readonly tokenHash: Buffer;
  readonly attribute: readonly string[];
}

export async function consumeAndRate(
  target: Tx,
  options: ConsumeRatingOptions,
): Promise<string | null> {
  const now = toIso(options.now);
  const consumed = await run(
    target,
    `UPDATE rating_requests SET consumed_at=$1,updated_at=$1
     WHERE company_id=$2 AND token_hash=$3 AND consumed_at IS NULL AND expires_at>$1
     RETURNING id,business_id,branch_id`,
    [now, options.tenant.company, options.tokenHash],
  );
  const request = consumed[0];
  if (request === undefined) return null;
  const ratingId = await insertRating(target, {
    ...options,
    requestId: request['id'] as string,
    business: request['business_id'] as string,
    branch: request['branch_id'] as string,
  });
  for (const employeeId of options.attribute) {
    await insertAttribution(target, { ...options, ratingId, employeeId });
  }
  return ratingId;
}
