import { staffAccessGrantedNoticeRequested, staffPinSetByOtherNoticeRequested } from '@pospay/contracts';
import { appendOutboxEvent, markEventConsumed, type Tx } from '@pospay/db';
import type { EditorLabelSnapshot } from '@pospay/i18n';
import { sql } from 'drizzle-orm';

import { readActorRoleSnapshot, readTemporaryStaffPinSet } from '../../identity/index.ts';
import type {
  StaffAccessNoticeActorRecord,
  StaffAccessNoticeEmployee,
  StaffAccessNoticeEvent,
  StaffAccessNoticePayload,
} from '../ports/staff-access-notice.port.ts';

/** اسم حجز الجرس: سطر واحد لكل حدث مصدر، فالتسليم المكرر ما يكرّرش الجرس. */
const CLAIM_CONSUMER_ID = 'staff.staff-access-notice-claim-v1';

/**
 * قارئ موظفة الجرس: الاسم العربي والإنجليزي ونشاطها، بلا هاتف ولا رقم سري ولا hash.
 *
 * @param companyId الشركة
 * @param employeeId الموظفة
 * @returns لقطة الموظفة أو null
 */
export async function readStaffAccessEmployee(
  tx: Tx,
  companyId: string,
  employeeId: string,
): Promise<StaffAccessNoticeEmployee | null> {
  const rows = await tx.execute<{
    business_id: string;
    name_ar: string | null;
    name_en: string;
  }>(sql`
    SELECT business_id, name_ar, name_en FROM employees
    WHERE company_id = ${companyId} AND id = ${employeeId}`);
  const row = rows[0];
  if (row === undefined) return null;
  return { businessId: row.business_id, nameAr: row.name_ar, nameEn: row.name_en };
}

/**
 * يقرأ الفاعل ولحظة فعله: مانح الدخول من سجل الوصول، أو من سطر الرقم المؤقت بعد إعادة الضبط.
 * لو غيّرت الموظفة الرقم بنفسها على الجهاز فـ`set_by` ب.null، فالفاعل بيتقرأ من سجل التدقيق.
 *
 * @param event حدث الوصول
 * @returns الفاعل ولحظة فعله أو null إن لم يوجد أثر
 */
export async function readStaffAccessActorRecord(
  tx: Tx,
  event: StaffAccessNoticeEvent,
): Promise<StaffAccessNoticeActorRecord | null> {
  // الحدث الحديث بيحمل الفاعل واللحظة؛ ما نقراش صفوف قابلة للتغيّر ونغيّر إشعار حدث قديم.
  if (event.actorUserId !== undefined && event.occurredAt !== undefined)
    return { actorUserId: event.actorUserId, occurredAt: event.occurredAt };
  if (event.kind === 'staff_access_granted') {
    const rows = await tx.execute<{ granted_by: string; updated_at: Date }>(sql`
      SELECT granted_by, updated_at FROM employee_staff_access
      WHERE company_id = ${event.companyId} AND employee_id = ${event.employeeId}`);
    const row = rows[0];
    if (row === undefined) return null;
    return { actorUserId: row.granted_by, occurredAt: new Date(row.updated_at) };
  }
  const pin = await readTemporaryStaffPinSet(tx, event.companyId, event.userId);
  if (pin !== null && pin.setBy !== null)
    return { actorUserId: pin.setBy, occurredAt: pin.setAt };
  const rows = await tx.execute<{ actor_user_id: string | null; at: Date }>(sql`
    SELECT actor_user_id, at FROM audit_log
    WHERE company_id = ${event.companyId} AND entity = 'cashier_pin'
      AND entity_id = ${event.userId} AND action = 'staff.pin_reset_temporary'
    ORDER BY at DESC, id DESC LIMIT 1`);
  const row = rows[0];
  if (row === undefined || row.actor_user_id === null) return null;
  return { actorUserId: row.actor_user_id, occurredAt: new Date(row.at) };
}

/**
 * يقرأ لقطة الفاعل: اسم الموظفة المرتبطة به ودوره وقت الفعل؛ ومن غيرهما تسمية عامة آمنة.
 *
 * @param companyId الشركة
 * @param businessId نشاط الموظفة
 * @param actorUserId المستخدم الفاعل
 * @param at لحظة الفعل
 * @returns لقطة المحرر أو null إن لم يوجد اسم ولا دور
 */
export async function readStaffAccessActorProfile(
  tx: Tx,
  companyId: string,
  businessId: string,
  actorUserId: string,
  at: Date,
): Promise<EditorLabelSnapshot | null> {
  const rows = await tx.execute<{ name_ar: string | null; name_en: string }>(sql`
    SELECT name_ar, name_en FROM employees
    WHERE company_id = ${companyId} AND business_id = ${businessId}
      AND user_id = ${actorUserId} AND deleted_at IS NULL
    LIMIT 1`);
  const employee = rows[0];
  const role = await readActorRoleSnapshot(tx, companyId, actorUserId, at);
  if (employee === undefined && role === null) return null;
  return {
    nameAr: employee?.name_ar ?? null,
    nameEn: employee?.name_en ?? null,
    role: role?.role ?? null,
    roleIsSystem: role?.roleIsSystem ?? null,
    roleNameAr: role?.roleNameAr ?? null,
    roleNameEn: role?.roleNameEn ?? null,
  };
}

/**
 * يحجز الحدث المصدر مرة واحدة: لو رجّع false فالجرس اتعمل قبل كده والتسليم المكرر يتجاهله.
 *
 * @param sourceEventId الحدث الذي سبّب الجرس
 * @returns هل فاز هذا الإدخال
 */
export function claimStaffAccessNotice(tx: Tx, sourceEventId: string): Promise<boolean> {
  return markEventConsumed(tx, CLAIM_CONSUMER_ID, sourceEventId);
}

/**
 * يكتب طلب الجرس في الأوتبوكس؛ اسم الحدث ثابت ومقروء من النوع، فالمستهلك يعرف أي جرس قادم.
 *
 * @param eventId معرف صف الأوتبوكس
 * @param employeeId الموظفة صاحبة الجرس
 * @param kind نوع الجرس
 * @param payload المجموعة والمعاملات الآمنة
 * @returns اكتمال الكتابة
 */
export async function appendStaffAccessNotice(
  tx: Tx,
  eventId: string,
  employeeId: string,
  kind: StaffAccessNoticeEvent['kind'],
  payload: StaffAccessNoticePayload,
): Promise<void> {
  await appendOutboxEvent(tx, eventId, {
    aggregateType: 'staff_access_notice',
    aggregateId: employeeId,
    eventType:
      kind === 'staff_access_granted'
        ? 'StaffAccessGrantedNoticeRequested'
        : 'StaffPinSetByOtherNoticeRequested',
    payload:
      kind === 'staff_access_granted'
        ? staffAccessGrantedNoticeRequested.parse(payload)
        : staffPinSetByOtherNoticeRequested.parse(payload),
  });
}
