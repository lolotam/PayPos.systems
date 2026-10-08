import { sql } from 'drizzle-orm';
import {
  check,
  type AnyPgColumn,
  date,
  doublePrecision,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { companies, branches } from './tenancy.ts';
import { employees } from './staff.ts';
import { employeePasskeys } from './staff-passkeys.ts';
import { devices } from './identity-devices.ts';
import { user } from './identity-auth.ts';

export const attendanceStates = pgTable(
  'attendance_states',
  {
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id),
    id: uuid('id').notNull(),
    businessId: uuid('business_id').notNull(),
    employeeId: uuid('employee_id').notNull(),
    lastAcceptedScanAt: timestamp('last_accepted_scan_at', { withTimezone: true }),
    // الرد المقبول محفوظ كاملاً؛ dedupe لا يعيد حسابه من حالة الجلسة الجديدة.
    lastResult: jsonb('last_result'),
  },
  (t) => [
    primaryKey({ columns: [t.companyId, t.id] }),
    uniqueIndex('attendance_states_employee_key').on(t.companyId, t.employeeId),
    foreignKey({
      columns: [t.companyId, t.businessId, t.employeeId],
      foreignColumns: [employees.companyId, employees.businessId, employees.id],
    }),
    index('attendance_states_business_idx').on(t.companyId, t.businessId),
    check('attendance_states_employee_id', sql`${t.id} = ${t.employeeId}`),
    check(
      'attendance_states_result_pair',
      sql`(${t.lastAcceptedScanAt} IS NULL) = (${t.lastResult} IS NULL)`,
    ),
  ],
);

export const attendanceSessions = pgTable(
  'attendance_sessions',
  {
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id),
    id: uuid('id').notNull(),
    businessId: uuid('business_id').notNull(),
    branchId: uuid('branch_id').notNull(),
    employeeId: uuid('employee_id').notNull(),
    workingDate: date('working_date').notNull(),
    timezone: text('timezone').notNull(),
    clockIn: timestamp('clock_in', { withTimezone: true }).notNull(),
    clockOut: timestamp('clock_out', { withTimezone: true }),
    status: text('status').notNull(),
    source: text('source').notNull(),
    closedBy: text('closed_by'),
    bindingId: uuid('binding_id'),
    bindingRevision: integer('binding_revision'),
    outBindingId: uuid('out_binding_id'),
    outBindingRevision: integer('out_binding_revision'),
    qrWindow: integer('qr_window'),
    outQrWindow: integer('out_qr_window'),
    // الموقع هو قراءة الهاتف وقت الحركة، لا دليل قاطع على وجود مادي.
    geo: text('geo').notNull(),
    outGeo: text('out_geo'),
    latitude: doublePrecision('latitude'),
    longitude: doublePrecision('longitude'),
    accuracy: doublePrecision('accuracy'),
    outLatitude: doublePrecision('out_latitude'),
    outLongitude: doublePrecision('out_longitude'),
    outAccuracy: doublePrecision('out_accuracy'),
    lateMinutes: integer('late_minutes').notNull(),
    scheduledStart: timestamp('scheduled_start', { withTimezone: true }),
    scheduledEnd: timestamp('scheduled_end', { withTimezone: true }),
    deviceId: uuid('device_id'),
    operatorId: uuid('operator_id').references(() => user.id),
    outDeviceId: uuid('out_device_id'),
    outOperatorId: uuid('out_operator_id').references(() => user.id),
  },
  (t) => [
    primaryKey({ columns: [t.companyId, t.id] }),
    foreignKey({
      columns: [t.companyId, t.businessId, t.employeeId],
      foreignColumns: [employees.companyId, employees.businessId, employees.id],
    }),
    foreignKey({
      columns: [t.companyId, t.businessId, t.branchId],
      foreignColumns: [branches.companyId, branches.businessId, branches.id],
    }),
    foreignKey({
      columns: [t.companyId, t.bindingId],
      foreignColumns: [employeePasskeys.companyId, employeePasskeys.id],
    }),
    foreignKey({
      columns: [t.companyId, t.outBindingId],
      foreignColumns: [employeePasskeys.companyId, employeePasskeys.id],
    }),
    foreignKey({
      columns: [t.companyId, t.deviceId],
      foreignColumns: [devices.companyId, devices.id],
    }),
    foreignKey({
      columns: [t.companyId, t.outDeviceId],
      foreignColumns: [devices.companyId, devices.id],
    }),
    uniqueIndex('attendance_sessions_one_open')
      .on(t.companyId, t.employeeId)
      .where(sql`${t.status} = 'OPEN'`),
    index('attendance_sessions_board_idx').on(
      t.companyId,
      t.businessId,
      t.branchId,
      t.workingDate,
      t.status,
    ),
    index('attendance_sessions_employee_date_idx').on(
      t.companyId,
      t.employeeId,
      t.workingDate,
      t.clockIn,
    ),
    index('attendance_sessions_business_date_idx').on(t.companyId, t.businessId, t.workingDate),
    ...attendanceReferenceIndexes(t),
    ...attendanceSessionChecks(t),
  ],
);

export const attendanceExceptions = pgTable(
  'attendance_exceptions',
  {
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id),
    id: uuid('id').notNull(),
    businessId: uuid('business_id').notNull(),
    employeeId: uuid('employee_id').notNull(),
    branchId: uuid('branch_id').notNull(),
    sessionId: uuid('session_id').notNull(),
    kind: text('kind').notNull(),
    status: text('status').notNull().default('OPEN'),
    raisedAt: timestamp('raised_at', { withTimezone: true }).notNull(),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    resolution: text('resolution'),
    resolvedBy: uuid('resolved_by').references(() => user.id),
    reason: text('reason'),
    // يزيد مع كل قرار يدوي حتى يرفض الطلب الذي يحمل نسخة قديمة.
    revision: integer('revision').notNull().default(0),
  },
  (t) => [
    primaryKey({ columns: [t.companyId, t.id] }),
    foreignKey({
      columns: [t.companyId, t.sessionId],
      foreignColumns: [attendanceSessions.companyId, attendanceSessions.id],
    }),
    foreignKey({
      columns: [t.companyId, t.businessId, t.employeeId],
      foreignColumns: [employees.companyId, employees.businessId, employees.id],
    }),
    foreignKey({
      columns: [t.companyId, t.businessId, t.branchId],
      foreignColumns: [branches.companyId, branches.businessId, branches.id],
    }),
    index('attendance_exceptions_session_idx').on(t.companyId, t.sessionId),
    index('attendance_exceptions_board_idx').on(
      t.companyId,
      t.businessId,
      t.branchId,
      t.status,
      t.raisedAt,
    ),
    index('attendance_exceptions_employee_idx').on(t.companyId, t.employeeId, t.raisedAt),
    index('attendance_exceptions_actor_idx').on(t.companyId, t.resolvedBy),
    // ضمان قاعدة البيانات أن الاشتباه يُرفع مرة واحدة لكل جلسة مهما تكررت الوظيفة.
    uniqueIndex('attendance_exceptions_one_suspected')
      .on(t.companyId, t.sessionId)
      .where(sql`${t.kind} = 'SUSPECTED_MISSED_OUT'`),
    check(
      'attendance_exceptions_kind',
      sql`${t.kind} IN ('NONE','OUT_OF_RANGE','SUSPECTED_MISSED_OUT')`,
    ),
    check('attendance_exceptions_status', sql`${t.status} IN ('OPEN','RESOLVED')`),
    check(
      'attendance_exceptions_resolution',
      sql`${t.resolution} IS NULL OR ${t.resolution} IN ('CLOSED_LATE','MISSED_OUT','ACKNOWLEDGED','CARD_SCAN')`,
    ),
    check(
      'attendance_exceptions_open_clear',
      sql`${t.status} <> 'OPEN' OR (${t.resolution} IS NULL AND ${t.resolvedBy} IS NULL AND ${t.resolvedAt} IS NULL AND ${t.reason} IS NULL)`,
    ),
    check(
      'attendance_exceptions_resolved_set',
      sql`${t.status} <> 'RESOLVED' OR (${t.resolution} IS NOT NULL AND ${t.resolvedAt} IS NOT NULL)`,
    ),
    check(
      'attendance_exceptions_reason_bounds',
      sql`${t.reason} IS NULL OR (${t.reason} = btrim(${t.reason}) AND char_length(${t.reason}) BETWEEN 1 AND 500)`,
    ),
  ],
);

export const attendanceClockChallenges = pgTable(
  'attendance_clock_challenges',
  {
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id),
    id: uuid('id').notNull(),
    businessId: uuid('business_id').notNull(),
    employeeId: uuid('employee_id').notNull(),
    branchId: uuid('branch_id').notNull(),
    bindingId: uuid('binding_id').notNull(),
    bindingRevision: integer('binding_revision').notNull(),
    userId: uuid('user_id')
      .notNull()
      .references(() => user.id),
    // نسخة الجلسة تمنع مشاركة تحدي بين جلستين حتى للمستخدم نفسه.
    sessionId: uuid('session_id').notNull(),
    operation: text('operation').notNull(),
    scanDigest: text('scan_digest').notNull(),
    issuedAt: timestamp('issued_at', { withTimezone: true }).notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.companyId, t.id] }),
    foreignKey({
      columns: [t.companyId, t.businessId, t.employeeId],
      foreignColumns: [employees.companyId, employees.businessId, employees.id],
    }),
    foreignKey({
      columns: [t.companyId, t.businessId, t.branchId],
      foreignColumns: [branches.companyId, branches.businessId, branches.id],
    }),
    foreignKey({
      columns: [t.companyId, t.bindingId],
      foreignColumns: [employeePasskeys.companyId, employeePasskeys.id],
    }),
    index('attendance_clock_challenges_employee_idx').on(t.companyId, t.employeeId, t.issuedAt),
    index('attendance_clock_challenges_branch_idx').on(t.companyId, t.branchId),
    index('attendance_clock_challenges_binding_idx').on(t.companyId, t.bindingId),
    index('attendance_clock_challenges_business_idx').on(t.companyId, t.businessId),
    index('attendance_clock_challenges_user_idx').on(t.companyId, t.userId),
    check('attendance_clock_challenges_operation', sql`${t.operation} IN ('CLOCK_IN','CLOCK_OUT')`),
    check('attendance_clock_challenges_revision', sql`${t.bindingRevision} > 0`),
    check('attendance_clock_challenges_digest', sql`${t.scanDigest} ~ '^[0-9a-f]{64}$'`),
  ],
);

// كل FK اختياري له فهرس حتى لا تفحص عمليات الإدارة كامل جدول الحضور.
function attendanceReferenceIndexes(t: {
  companyId: AnyPgColumn;
  bindingId: AnyPgColumn;
  outBindingId: AnyPgColumn;
  deviceId: AnyPgColumn;
  outDeviceId: AnyPgColumn;
  operatorId: AnyPgColumn;
  outOperatorId: AnyPgColumn;
}) {
  return [
    index('attendance_sessions_binding_idx').on(t.companyId, t.bindingId),
    index('attendance_sessions_out_binding_idx').on(t.companyId, t.outBindingId),
    index('attendance_sessions_device_idx').on(t.companyId, t.deviceId),
    index('attendance_sessions_out_device_idx').on(t.companyId, t.outDeviceId),
    index('attendance_sessions_operator_idx').on(t.companyId, t.operatorId),
    index('attendance_sessions_out_operator_idx').on(t.companyId, t.outOperatorId),
  ];
}

function attendanceSessionChecks(
  t: Record<
    | 'status'
    | 'source'
    | 'clockOut'
    | 'clockIn'
    | 'closedBy'
    | 'lateMinutes'
    | 'geo'
    | 'outGeo'
    | 'bindingId'
    | 'bindingRevision'
    | 'outBindingId'
    | 'outBindingRevision'
    | 'latitude'
    | 'longitude'
    | 'accuracy'
    | 'outLatitude'
    | 'outLongitude'
    | 'outAccuracy',
    AnyPgColumn
  >,
) {
  return [
    check('attendance_sessions_status', sql`${t.status} IN ('OPEN','CLOSED','MISSED_OUT')`),
    check('attendance_sessions_source', sql`${t.source} IN ('QR','BARCODE')`),
    check(
      'attendance_sessions_close_pair',
      sql`(${t.status} = 'OPEN' AND ${t.clockOut} IS NULL AND ${t.closedBy} IS NULL) OR (${t.status} <> 'OPEN' AND ${t.clockOut} >= ${t.clockIn} AND ${t.closedBy} IN ('EMPLOYEE','MISSED_OUT'))`,
    ),
    check('attendance_sessions_lateness', sql`${t.lateMinutes} >= 0`),
    check(
      'attendance_sessions_geo',
      sql`${t.geo} IN ('OK','NONE','OUT_OF_RANGE') AND (${t.outGeo} IS NULL OR ${t.outGeo} IN ('OK','NONE','OUT_OF_RANGE'))`,
    ),
    check(
      'attendance_sessions_binding_pair',
      sql`(${t.bindingId} IS NULL) = (${t.bindingRevision} IS NULL) AND (${t.bindingRevision} IS NULL OR ${t.bindingRevision}>0)`,
    ),
    check(
      'attendance_sessions_out_binding_pair',
      sql`(${t.outBindingId} IS NULL) = (${t.outBindingRevision} IS NULL) AND (${t.outBindingRevision} IS NULL OR ${t.outBindingRevision}>0)`,
    ),
    check(
      'attendance_sessions_location',
      sql`(${t.latitude} IS NULL AND ${t.longitude} IS NULL AND ${t.accuracy} IS NULL) OR (${t.latitude} BETWEEN -90 AND 90 AND ${t.longitude} BETWEEN -180 AND 180 AND ${t.accuracy} >= 0)`,
    ),
    check(
      'attendance_sessions_out_location',
      sql`(${t.outLatitude} IS NULL AND ${t.outLongitude} IS NULL AND ${t.outAccuracy} IS NULL) OR (${t.outLatitude} BETWEEN -90 AND 90 AND ${t.outLongitude} BETWEEN -180 AND 180 AND ${t.outAccuracy} >= 0)`,
    ),
  ];
}
