import { sql } from 'drizzle-orm';
import {
  check,
  foreignKey,
  uniqueIndex,
  type AnyPgColumn,
  type PgTableExtraConfigValue,
} from 'drizzle-orm/pg-core';
import { attendanceChangeRequests } from './staff-attendance-change-requests.ts';
// ربط الجلسة اليدوية بطلبها (26b): مفتاح أجنبي فوري، جلسة واحدة لكل طلب، وشكل الجلسة اليدوية.
export function manualSessionLinks(
  t: Record<
    | 'companyId'
    | 'changeRequestId'
    | 'source'
    | 'status'
    | 'closedBy'
    | 'clockOut'
    | 'bindingId'
    | 'outBindingId'
    | 'deviceId'
    | 'outDeviceId'
    | 'operatorId'
    | 'outOperatorId'
    | 'qrWindow'
    | 'outQrWindow'
    | 'latitude'
    | 'longitude'
    | 'accuracy'
    | 'outLatitude'
    | 'outLongitude'
    | 'outAccuracy'
    | 'geo'
    | 'outGeo',
    AnyPgColumn
  >,
): PgTableExtraConfigValue[] {
  return [
    foreignKey({
      name: 'attendance_sessions_change_request_fk',
      columns: [t.companyId, t.changeRequestId],
      foreignColumns: [attendanceChangeRequests.companyId, attendanceChangeRequests.id],
    }),
    uniqueIndex('attendance_sessions_change_request_idx')
      .on(t.companyId, t.changeRequestId)
      .where(sql`${t.changeRequestId} IS NOT NULL`),
    check(
      'attendance_sessions_manual_link',
      sql`(${t.source} = 'MANUAL') = (${t.changeRequestId} IS NOT NULL)`,
    ),
    check(
      'attendance_sessions_manual_shape',
      sql`(${t.closedBy} <> 'MANUAL' OR ${t.source} = 'MANUAL') AND (${t.source} <> 'MANUAL' OR (${t.status} = 'CLOSED' AND ${t.closedBy} IS NOT NULL AND ${t.closedBy} = 'MANUAL' AND ${t.clockOut} IS NOT NULL AND ${t.bindingId} IS NULL AND ${t.outBindingId} IS NULL AND ${t.deviceId} IS NULL AND ${t.outDeviceId} IS NULL AND ${t.operatorId} IS NULL AND ${t.outOperatorId} IS NULL AND ${t.qrWindow} IS NULL AND ${t.outQrWindow} IS NULL AND ${t.latitude} IS NULL AND ${t.longitude} IS NULL AND ${t.accuracy} IS NULL AND ${t.outLatitude} IS NULL AND ${t.outLongitude} IS NULL AND ${t.outAccuracy} IS NULL AND ${t.geo} = 'NONE' AND (${t.outGeo} IS NULL OR ${t.outGeo} = 'NONE')))`,
    ),
  ];
}
