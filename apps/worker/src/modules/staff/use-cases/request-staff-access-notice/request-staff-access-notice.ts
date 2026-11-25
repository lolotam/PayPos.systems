import type { IdGenerator } from '@pospay/db';

import {
  staffAccessNoticeParameters,
  type StaffAccessNoticeFallback,
  type StaffAccessNoticeParameters,
} from '../../domain/staff-access-notice.ts';
import { inAppRecipientGroups } from '../../domain/not-clocked-in.ts';
import type { Clock } from '../../ports/clock.port.ts';
import type {
  StaffAccessNoticeEvent,
  StaffAccessNoticePayload,
  StaffAccessNoticePorts,
} from '../../ports/staff-access-notice.port.ts';

/** لقطة الفاعل الفارغة: مفيش اسم ولا دور، فالتسمية العامة الآمنة هي البديل. */
const NO_ACTOR = {
  nameAr: null,
  nameEn: null,
  role: null,
  roleIsSystem: null,
  roleNameAr: null,
  roleNameEn: null,
} as const;

/** يطلب جرس المالك عن وصول دخول موظفة أو إعادة ضبط رقمها السري، مرة واحدة لكل حدث مصدر (076-F2b-4). */
export class RequestStaffAccessNotice {
  constructor(
    private readonly ports: StaffAccessNoticePorts,
    private readonly ids: IdGenerator,
    private readonly clock: Clock,
    private readonly fallback: StaffAccessNoticeFallback,
  ) {}

  async execute(event: StaffAccessNoticeEvent): Promise<void> {
    // الموظفة والفاعل لازم يكونوا موجودين قبل الحجز؛ حدث ناقص معناه بيانات غلط، فالفشل يبقى ظاهر.
    const employee = await this.ports.readEmployee(event.companyId, event.employeeId);
    if (employee === null) throw new Error('STAFF_ACCESS_EVENT_INVALID');
    const actor = await this.ports.readActorRecord(event);
    if (actor === null) throw new Error('STAFF_ACCESS_EVENT_INVALID');
    if (!(await this.ports.companyOpen(event.companyId))) return;
    const owners = await this.ports.owners(event.companyId, this.clock.now());
    const branch = await this.ports.place(event.companyId, employee.businessId, event.branchId);
    const won = await this.ports.claim(event.sourceEventId);
    // الحجز قبل الكتابة: لو ما فزناش، أو الفرع ما عادش موجود، أو مفيش مالك، فمفيش جرس يتكرر.
    if (!won || branch === null || owners.length === 0) return;
    const profile = await this.ports.readActorProfile(
      event.companyId,
      employee.businessId,
      actor.actorUserId,
      actor.occurredAt,
    );
    const parameters = staffAccessNoticeParameters({
      employee,
      actor: profile ?? NO_ACTOR,
      branch,
      occurredAt: actor.occurredAt,
      timeZone: branch.timeZone,
      fallback: this.fallback,
    });
    if (parameters === null) return;
    for (const group of inAppRecipientGroups(owners))
      await this.append(event, employee.businessId, group, parameters);
  }

  private async append(
    event: StaffAccessNoticeEvent,
    businessId: string,
    group: readonly string[],
    parameters: StaffAccessNoticeParameters,
  ): Promise<void> {
    const payload: StaffAccessNoticePayload = {
      schema_version: 1,
      business_id: businessId,
      branch_id: event.branchId,
      employee_id: event.employeeId,
      notification_recipients: group.map((user_id) => ({
        channel: 'IN_APP',
        user_id,
        locale: 'ar',
        template_key: event.kind,
        template_revision: 1,
        safe_parameters: parameters,
      })),
    };
    await this.ports.outbox.append(this.ids.newId(), event.employeeId, event.kind, payload);
  }
}
