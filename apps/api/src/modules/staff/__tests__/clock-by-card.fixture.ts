import { createEmployeeCardHash } from '../persistence/employee-card-hash.ts';
import { attendanceFixture, type AttendanceFixture } from './clock-attendance.fixture.ts';
import { createCardClockTransactions } from '../persistence/card-clock-transactions.ts';
import { createEmployeeCardAccess } from '../persistence/employee-card-access.adapter.ts';
import { createEmployeeCards } from '../persistence/drizzle-employee-cards.ts';
import { ClockByCard } from '../use-cases/clock-by-card/clock-by-card.ts';
import { IssueEmployeeCard } from '../use-cases/issue-employee-card/issue-employee-card.usecase.ts';
import { RevokeEmployeeCard } from '../use-cases/revoke-employee-card/revoke-employee-card.usecase.ts';

// كود اصطناعي فقط؛ لا يخص أي بطاقة حقيقية.
export const CARD_CODE = 'CARD-0001';
export const cardHash = createEmployeeCardHash(Buffer.alloc(32, 7));

export interface CardFixture extends Omit<AttendanceFixture, 'scope'> {
  operatorId: string;
  viewerId: string;
  otherBranch: string;
  otherDeviceId: string;
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
  // ساعات الحضور اصطناعية ثابتة؛ العضوية تغطيها مهما كان وقت تشغيل الاختبار الحقيقي.
  await f.owner`UPDATE memberships SET starts_at='2026-01-01' WHERE company_id=${f.companyId} AND id=${f.membershipId}`;
  const operatorId = await addMember(
    f,
    'card-manager@example.test',
    'business_manager',
    'BUSINESS',
    f.businessId,
  );
  await f.owner`INSERT INTO memberships(company_id,id,user_id,role_id,role_owner_key,scope_type,scope_id,starts_at)
    SELECT ${f.companyId},${f.ids.newId()},${operatorId},id,'global','BUSINESS',${f.businessId},'2026-01-01' FROM roles WHERE code='cashier' AND company_id IS NULL`;
  const viewerId = await addMember(f, 'card-viewer@example.test', 'viewer', 'BRANCH', f.branchId);
  const otherBranch = f.ids.newId();
  await f.owner`INSERT INTO branches(company_id,id,business_id,name_en) VALUES(${f.companyId},${otherBranch},${f.businessId},'Synthetic other branch')`;
  const cardId = f.ids.newId();
  await f.owner`INSERT INTO employee_cards(company_id,id,business_id,employee_id,card_code_hash,card_code_suffix,issued_at,issued_by)
    VALUES(${f.companyId},${cardId},${f.businessId},${f.employeeId},${cardHash(f.companyId, CARD_CODE)},'0001',clock_timestamp(),${operatorId})`;
  // جهاز اصطناعي نشط؛ اختبار المعاملة يعيد فحص حالة الجهاز تحت القفل.
  const deviceId = f.ids.newId();
  await f.owner`INSERT INTO devices(company_id,id,branch_id,label,status,approved_by,approved_at,token_hash,token_expires_at)
    VALUES(${f.companyId},${deviceId},${f.branchId},'Synthetic card device','ACTIVE',${operatorId},clock_timestamp(),'synthetic-hash','2027-01-01')`;
  const otherDeviceId = f.ids.newId();
  await f.owner`INSERT INTO devices(company_id,id,branch_id,label,status,approved_by,approved_at,token_hash,token_expires_at)
    VALUES(${f.companyId},${otherDeviceId},${otherBranch},'Synthetic other device','ACTIVE',${operatorId},clock_timestamp(),'synthetic-hash','2027-01-01')`;
  const access = createEmployeeCardAccess();
  const clockByCard = new ClockByCard(
    createCardClockTransactions(f.database, f.ids, cardHash),
    f.clock,
    f.ids,
  );
  const admin = createEmployeeCards(f.database, f.ids, f.clock, access, cardHash);
  return {
    ...f,
    operatorId,
    viewerId,
    otherBranch,
    otherDeviceId,
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
