import { attendanceFixture, type AttendanceFixture } from './clock-attendance.fixture.ts';
import { createCardClockTransactions } from '../persistence/card-clock-transactions.ts';
import { createEmployeeCardAccess } from '../persistence/employee-card-access.adapter.ts';
import { createEmployeeCards } from '../persistence/drizzle-employee-cards.ts';
import { ClockByCard } from '../use-cases/clock-by-card/clock-by-card.ts';
import { IssueEmployeeCard } from '../use-cases/issue-employee-card/issue-employee-card.usecase.ts';
import { RevokeEmployeeCard } from '../use-cases/revoke-employee-card/revoke-employee-card.usecase.ts';

// كود اصطناعي فقط؛ لا يخص أي بطاقة حقيقية.
export const CARD_CODE = 'CARD-0001';

export interface CardFixture extends Omit<AttendanceFixture, 'scope'> {
  operatorId: string;
  viewerId: string;
  otherBranch: string;
  cardId: string;
  clockByCard: ClockByCard;
  issue: IssueEmployeeCard;
  revoke: RevokeEmployeeCard;
  scope: {
    companyId: string;
    businessId: string;
    branchId: string;
    deviceId: string;
    operatorId: string;
  };
  idem: () => { key: string; fingerprint: string };
}

/**
 * يبني على حضور PR 22 فيعيد استخدام الجلسة الشخصية وpasskey وQR، ثم يضيف
 * عامل استقبال له الصلاحية وكارتاً نشطاً للتحقق من المسار الثاني.
 *
 * @returns الـ fixture مع أدوات الكارت والعامل والفرع الآخر
 */
export async function clockByCardFixture(): Promise<CardFixture> {
  const f = await attendanceFixture();
  const operatorId = await addMember(f, 'card-manager@example.test', 'business_manager', 'BUSINESS', f.businessId);
  const viewerId = await addMember(f, 'card-viewer@example.test', 'viewer', 'BRANCH', f.branchId);
  const otherBranch = f.ids.newId();
  await f.owner`INSERT INTO branches(company_id,id,business_id,name_en) VALUES(${f.companyId},${otherBranch},${f.businessId},'Synthetic other branch')`;
  const cardId = f.ids.newId();
  await f.owner`INSERT INTO employee_cards(company_id,id,business_id,employee_id,card_code,issued_at,issued_by)
    VALUES(${f.companyId},${cardId},${f.businessId},${f.employeeId},${CARD_CODE},clock_timestamp(),${operatorId})`;
  // الجهاز يجب أن يوجد فعلاً لأن attendance_sessions.device_id مفتاح خارجي؛ الحالة لا تهم مسار الاستخدام.
  const deviceId = f.ids.newId();
  await f.owner`INSERT INTO devices(company_id,id,branch_id,label,status)
    VALUES(${f.companyId},${deviceId},${f.branchId},'Synthetic card device','PENDING')`;
  const access = createEmployeeCardAccess();
  const clockByCard = new ClockByCard(
    createCardClockTransactions(f.database, f.ids),
    f.clock,
    f.ids,
  );
  const admin = createEmployeeCards(f.database, f.ids, f.clock, access);
  return {
    ...f,
    operatorId,
    viewerId,
    otherBranch,
    cardId,
    clockByCard,
    issue: new IssueEmployeeCard(admin),
    revoke: new RevokeEmployeeCard(admin),
    scope: {
      companyId: f.companyId,
      businessId: f.businessId,
      branchId: f.branchId,
      deviceId,
      operatorId,
    },
    idem: () => ({ key: f.ids.newId(), fingerprint: 'synthetic-command-body' }),
  };
}

async function addMember(
  f: AttendanceFixture,
  email: string,
  roleCode: string,
  scopeType: 'BUSINESS' | 'BRANCH',
  scopeId: string,
): Promise<string> {
  const userId = f.ids.newId();
  await f.owner`INSERT INTO "user"(id,name,email) VALUES(${userId},'Synthetic card operator',${email})`;
  await f.owner`INSERT INTO memberships(company_id,id,user_id,role_id,role_owner_key,scope_type,scope_id,starts_at)
    SELECT ${f.companyId},${f.ids.newId()},${userId},id,'global',${scopeType},${scopeId},'2026-01-01'
    FROM roles WHERE code=${roleCode} AND company_id IS NULL`;
  return userId;
}
