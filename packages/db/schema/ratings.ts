import { sql, type BuildExtraConfigColumns } from 'drizzle-orm';
import {
  check,
  customType,
  date,
  foreignKey,
  index,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { customers } from './customers.ts';
import { employees } from './staff.ts';
import { branches, businesses, companies } from './tenancy.ts';

const xid8 = customType<{ data: string }>({ dataType: () => 'xid8' });
const bytea = customType<{ data: Buffer }>({ dataType: () => 'bytea' });

const ratingRequestsColumns = {
  companyId: uuid('company_id')
    .notNull()
    .references(() => companies.id),
  id: uuid('id').notNull(),
  businessId: uuid('business_id').notNull(),
  customerId: uuid('customer_id').notNull(),
  // يوم الطلب بالتوقيت المحلي للفرع، وليس يوم UTC ولا تاريخ تسجيل الجلسة.
  businessDate: date('business_date', { mode: 'string' }).notNull(),
  branchId: uuid('branch_id').notNull(),
  dueAt: timestamp('due_at', { withTimezone: true }).notNull(),
  sendDeadline: timestamp('send_deadline', { withTimezone: true }),
  status: text('status').notNull().default('SCHEDULED'),
  cancelReason: text('cancel_reason'),
  // بصمة الرابط الكامل فقط؛ الرابط نفسه لا يُحفظ في أي مكان.
  tokenHash: bytea('token_hash'),
  // إصدار المفتاح الذي اشتق منه المرسل الرابط وقت المطالبة.
  tokenKeyVersion: smallint('token_key_version'),
  expiresAt: timestamp('expires_at', { withTimezone: true }),
  claimedAt: timestamp('claimed_at', { withTimezone: true }),
  // يربط نتيجة الإرسال بحدث الجاهزية نفسه دون قبول نتيجة أخرى.
  readyEventId: uuid('ready_event_id'),
  sentAt: timestamp('sent_at', { withTimezone: true }),
  consumedAt: timestamp('consumed_at', { withTimezone: true }),
  // لا تكتبهما إلا قاعدة البيانات؛ يثبتان معاملة المطالبة والاستهلاك للصفوف التابعة.
  claimXactId: xid8('claim_xact_id'),
  consumeXactId: xid8('consume_xact_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
};

type RequestSelf = BuildExtraConfigColumns<string, typeof ratingRequestsColumns, 'pg'>;

const requestKeys = (t: RequestSelf) => [
  primaryKey({ name: 'rating_requests_pkey', columns: [t.companyId, t.id] }),
  unique('rating_requests_day_key').on(t.companyId, t.businessId, t.customerId, t.businessDate),
  unique('rating_requests_business_id_key').on(t.companyId, t.businessId, t.id),
  unique('rating_requests_branch_id_key').on(t.companyId, t.businessId, t.branchId, t.id),
  uniqueIndex('rating_requests_ready_event_key')
    .on(t.companyId, t.readyEventId)
    .where(sql`${t.readyEventId} IS NOT NULL`),
  uniqueIndex('rating_requests_token_hash_key')
    .on(t.companyId, t.tokenHash)
    .where(sql`${t.tokenHash} IS NOT NULL`),
];

const requestRelations = (t: RequestSelf) => [
  foreignKey({
    name: 'rating_requests_business_fk',
    columns: [t.companyId, t.businessId],
    foreignColumns: [businesses.companyId, businesses.id],
  }),
  foreignKey({
    name: 'rating_requests_branch_fk',
    columns: [t.companyId, t.businessId, t.branchId],
    foreignColumns: [branches.companyId, branches.businessId, branches.id],
  }),
  foreignKey({
    name: 'rating_requests_customer_fk',
    columns: [t.companyId, t.customerId],
    foreignColumns: [customers.companyId, customers.id],
  }),
];

const requestTokenChecks = (t: RequestSelf) => [
  check(
    'rating_requests_token_group',
    sql`(${t.tokenKeyVersion} IS NULL) = (${t.tokenHash} IS NULL)
      AND (${t.expiresAt} IS NULL) = (${t.tokenHash} IS NULL)
      AND (${t.claimedAt} IS NULL) = (${t.tokenHash} IS NULL)
      AND (${t.readyEventId} IS NULL) = (${t.tokenHash} IS NULL)`,
  ),
  check(
    'rating_requests_token_status',
    sql`(${t.status} IN ('SENDING','SENT')) = (${t.tokenHash} IS NOT NULL)`,
  ),
  check(
    'rating_requests_token_hash_len',
    sql`${t.tokenHash} IS NULL OR octet_length(${t.tokenHash}) = 32`,
  ),
  check(
    'rating_requests_key_version',
    sql`${t.tokenKeyVersion} IS NULL OR ${t.tokenKeyVersion} > 0`,
  ),
  check(
    'rating_requests_expiry',
    sql`${t.tokenHash} IS NULL OR ${t.expiresAt} = ${t.claimedAt} + interval '168 hours'`,
  ),
];

const requestChecks = (t: RequestSelf) => [
  check('rating_requests_status', sql`${t.status} IN ('SCHEDULED','SENDING','SENT','CANCELLED')`),
  check(
    'rating_requests_cancel_reason',
    sql`${t.cancelReason} IS NULL OR ${t.cancelReason} IN ('NO_ACTIVE_LINE','PAST_DEADLINE','OPTED_OUT')`,
  ),
  check(
    'rating_requests_cancel_pair',
    sql`(${t.status} = 'CANCELLED') = (${t.cancelReason} IS NOT NULL)`,
  ),
  ...requestTokenChecks(t),
  check('rating_requests_sent_pair', sql`(${t.status} = 'SENT') = (${t.sentAt} IS NOT NULL)`),
  check(
    'rating_requests_consumed_token',
    sql`${t.consumedAt} IS NULL OR ${t.tokenHash} IS NOT NULL`,
  ),
  check(
    'rating_requests_consumed_window',
    sql`${t.consumedAt} IS NULL OR (${t.consumedAt} >= ${t.claimedAt} AND ${t.consumedAt} < ${t.expiresAt})`,
  ),
  check(
    'rating_requests_proofs',
    sql`(${t.claimXactId} IS NOT NULL) = (${t.tokenHash} IS NOT NULL)
      AND (${t.consumeXactId} IS NOT NULL) = (${t.consumedAt} IS NOT NULL)`,
  ),
];

const requestIndexes = (t: RequestSelf) => [
  index('rating_requests_due_idx')
    .on(t.companyId, t.dueAt, t.id)
    .where(sql`${t.status} = 'SCHEDULED'`),
  index('rating_requests_customer_idx').on(t.companyId, t.customerId),
  index('rating_requests_branch_idx').on(t.companyId, t.businessId, t.branchId),
];

export const ratingRequests = pgTable('rating_requests', ratingRequestsColumns, (t) => [
  ...requestKeys(t),
  ...requestRelations(t),
  ...requestChecks(t),
  ...requestIndexes(t),
]);

export const ratingPerformers = pgTable(
  'rating_performers',
  {
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id),
    id: uuid('id').notNull(),
    requestId: uuid('request_id').notNull(),
    businessId: uuid('business_id').notNull(),
    employeeId: uuid('employee_id').notNull(),
  },
  (t) => [
    primaryKey({ name: 'rating_performers_pkey', columns: [t.companyId, t.id] }),
    unique('rating_performers_request_employee_key').on(
      t.companyId,
      t.businessId,
      t.requestId,
      t.employeeId,
    ),
    foreignKey({
      name: 'rating_performers_request_fk',
      columns: [t.companyId, t.businessId, t.requestId],
      foreignColumns: [ratingRequests.companyId, ratingRequests.businessId, ratingRequests.id],
    }),
    foreignKey({
      name: 'rating_performers_employee_fk',
      columns: [t.companyId, t.businessId, t.employeeId],
      foreignColumns: [employees.companyId, employees.businessId, employees.id],
    }),
    index('rating_performers_employee_idx').on(t.companyId, t.businessId, t.employeeId),
  ],
);

export const ratings = pgTable(
  'ratings',
  {
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id),
    id: uuid('id').notNull(),
    requestId: uuid('request_id').notNull(),
    businessId: uuid('business_id').notNull(),
    branchId: uuid('branch_id').notNull(),
    stars: smallint('stars').notNull(),
    // نص العميل يُقرأ بصلاحية قراءة التقييمات فقط ولا يدخل السجلات أبداً.
    comment: text('comment'),
    submittedAt: timestamp('submitted_at', { withTimezone: true }).notNull(),
  },
  (t) => [
    primaryKey({ name: 'ratings_pkey', columns: [t.companyId, t.id] }),
    unique('ratings_request_key').on(t.companyId, t.requestId),
    unique('ratings_attribution_key').on(
      t.companyId,
      t.id,
      t.requestId,
      t.businessId,
      t.branchId,
      t.stars,
      t.submittedAt,
    ),
    foreignKey({
      name: 'ratings_request_fk',
      columns: [t.companyId, t.businessId, t.branchId, t.requestId],
      foreignColumns: [
        ratingRequests.companyId,
        ratingRequests.businessId,
        ratingRequests.branchId,
        ratingRequests.id,
      ],
    }),
    index('ratings_branch_idx').on(t.companyId, t.businessId, t.branchId, t.submittedAt),
    index('ratings_request_fk_idx').on(t.companyId, t.businessId, t.branchId, t.requestId),
    check('ratings_stars', sql`${t.stars} BETWEEN 1 AND 5`),
    check('ratings_comment_length', sql`${t.comment} IS NULL OR char_length(${t.comment}) <= 1000`),
  ],
);
