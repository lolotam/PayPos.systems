import {
  businessCalendar,
  readCommissionBranchAttachments,
  readCommissionBranchNames,
  readCommissionCustomerNames,
  readCommissionFeatureEnabled,
  readCommissionReviewAccess,
  readCommissionScope,
  readCommissionServiceNames,
  readCommissionStatementEmployees,
} from '../../../../test/harness.ts';
import type { CommissionStatementGenerateReaders } from '../persistence/commission-statement-generate-scope.ts';
import { estimateFixture, ids, type EstimateFixture } from './commission-estimate.fixture.ts';

export { ids };
export { PERIOD } from './commission-estimate.fixture.ts';

/** 2 ديسمبر بتوقيت الكويت: نوفمبر خلص، وديسمبر لسه ما خلصش. */
const DECEMBER_SECOND = new Date('2026-12-02T09:00:00Z');

export type StatementFixture = EstimateFixture;

/** نشاط الاختبار بنفس بنود التقدير، وساعة العمولات على 2 ديسمبر عشان شهر نوفمبر يبقى منتهي. */
export function statementFixture(): Promise<StatementFixture> {
  return estimateFixture({ commissionsClock: { now: () => DECEMBER_SECOND } });
}

export const statementPath = (business: string, period: string, suffix = ''): string =>
  `/v1/businesses/${business}/commission-statements/${period}${suffix}`;

/** إنشاء كشف الشهر بمفتاح إعادة إرسال، والعميل هو الكوكي. */
export const generateStatement = (
  f: StatementFixture,
  cookie: string,
  key: string,
  period = '2026-11',
) =>
  f.h.send('POST', statementPath(f.business, period, '/generate'), {
    cookie,
    company: f.company,
    key,
  });

/** عرض الكشف بكوكي القارئ. */
export const readStatement = (f: StatementFixture, cookie: string, period = '2026-11') =>
  f.h.send('GET', statementPath(f.business, period), { cookie, company: f.company });

/** سطر كشف الشهر في قاعدة البيانات، أو undefined لو ما فيهوش. */
export async function statementRow(
  f: StatementFixture,
  period: string,
): Promise<Record<string, unknown> | undefined> {
  const [row] = await f.h.owner`SELECT status, current_fingerprint, reviewed_fingerprint,
    reviewed_statement_fingerprint FROM commission_statements
    WHERE company_id=${f.company} AND business_id=${f.business} AND period=${period}`;
  return row;
}

/** عدد صفوف التدقيق والـ outbox، علشان اختبار «إنشاء الكشف بيكتب تدقيق ومفيش حدث». */
export async function auditAndOutboxCounts(
  f: StatementFixture,
): Promise<{ audits: number; outbox: number }> {
  const [audits] = await f.h.owner`SELECT count(*)::int AS count FROM audit_log
    WHERE action='commission_statement.generated'`;
  const [outbox] = await f.h.owner`SELECT count(*)::int AS count FROM outbox`;
  return { audits: audits?.['count'] as number, outbox: outbox?.['count'] as number };
}

/**
 * مستخدم بصلاحيات مخصصة: كل منحة بدور مخصص وعضوية على نطاقها، علشان نركّب «المراجعة على النشاط
 * والقراءة على فرع واحد» وأمثالها (CM-33d). نطاق BRANCH بياخد الفرع الأول.
 */
export async function memberWithGrants(
  f: StatementFixture,
  label: string,
  grants: readonly { permission: string; scope: 'BUSINESS' | 'BRANCH' | 'SECOND_BRANCH' }[],
): Promise<{ cookie: string; userId: string; membershipIds: string[] }> {
  const email = `commission-statement-${label}-${ids.newId()}@example.test`;
  const cookie = await f.h.signedInOperator(email);
  const [user] = await f.h.owner`SELECT id FROM "user" WHERE email=${email}`;
  const userId = user?.['id'] as string;
  const membershipIds: string[] = [];
  for (const [index, grant] of grants.entries()) {
    const role = ids.newId();
    const membership = ids.newId();
    await f.h.owner`INSERT INTO roles(id,company_id,code,name_en)
      VALUES (${role},${f.company},${`statement_${label}_${index}_${role.slice(-8)}`},'Statement test role')`;
    await f.h.owner`INSERT INTO role_permissions(role_id,role_owner_key,company_id,permission_code)
      VALUES (${role},${f.company},${f.company},${grant.permission})`;
    await f.h.owner`INSERT INTO memberships(
      company_id,id,user_id,role_id,role_owner_key,scope_type,scope_id)
      VALUES (${f.company},${membership},${userId},${role},${f.company},${grant.scope === 'BUSINESS' ? 'BUSINESS' : 'BRANCH'},
        ${scopeIdOf(f, grant.scope)}::uuid)`;
    membershipIds.push(membership);
  }
  return { cookie, userId, membershipIds };
}

/** معرّف النطاق: النشاط، أو أحد فرعيه. */
function scopeIdOf(f: StatementFixture, scope: 'BUSINESS' | 'BRANCH' | 'SECOND_BRANCH'): string {
  if (scope === 'BUSINESS') return f.business;
  return scope === 'BRANCH' ? f.branch : f.secondBranch;
}

export const REVIEW = 'review:commissions:business';
export const READ = 'read:commissions:business';

/**
 * قراء كاتب الإنشاء الحقيقيين بنفس ربط جذر التطبيق، علشان اختبار الانتظار على المفتاح يبني حد المعاملة
 * مباشرة من غير HTTP (الطلبين بيتتبّعوا باتصالهم).
 */
export function statementReaders(): CommissionStatementGenerateReaders {
  return {
    businessCalendar,
    reviewAccess: readCommissionReviewAccess,
    providers: {
      scope: async (...args) => {
        const scope = await readCommissionScope(...args);
        if (scope.kind !== 'scope') return { kind: scope.kind };
        return { kind: 'scope', ...scope.scope };
      },
      featureEnabled: readCommissionFeatureEnabled,
      employees: readCommissionStatementEmployees,
      attachments: readCommissionBranchAttachments,
      branchNames: readCommissionBranchNames,
      serviceNames: readCommissionServiceNames,
      customerNames: readCommissionCustomerNames,
    },
  };
}
