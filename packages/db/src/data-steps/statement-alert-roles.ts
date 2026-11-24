import { sql } from 'drizzle-orm';
import type postgres from 'postgres';

import type { DataStepApp } from './coverage.ts';
import type { IdGenerator, Tx } from '../with-tenant.ts';

/**
 * رفض ثابت النص لدور ترحيل بلا تجاوز للعزل: لا يحمل رابطاً ولا باسورد ولا بيانات.
 * بدون التجاوز، قراءة الشركات تحت FORCE RLS ترجع صفر صفوف، والخطوة كانت هتعدّي من غير ما تنضّف أي قاعدة.
 */
export class StatementAlertRolesRoleRefusedError extends Error {
  readonly code = '42501';
  constructor() {
    super(
      'Migration data step statement-alert-roles needs a superuser or BYPASSRLS migration role; it would read no companies under FORCE RLS',
    );
  }
}

/** عدّادات خطوة التنضيف دون أي أسماء أو معرّفات: الشركات والقواعد المقروءة والقواعد اللي اتغيّرت. */
export interface StatementAlertRolesCounts {
  readonly companies: number;
  readonly read: number;
  readonly cleaned: number;
}

type RuleRow = {
  id: string;
  business_id: string;
  branch_id: string | null;
  kind: string;
  enabled: boolean;
  recipient_roles: string[];
  channels: string[];
  delay_minutes: number | null;
  lead_minutes: number | null;
  revision: number;
};

/**
 * الأنواع والدور المرفوض زي ما كانوا وقت كتابة الخطوة دي (migration 0246، ADR-0038: الخطوة بتفضل قابلة للتشغيل على الـ schema
 * بتاعها): نسخة مجمّدة مقصودة من جدول المجال، فتغيير القاعدة في الكود بعدين مايغيّرش اللي الخطوة دي بتعمله.
 */
const STATEMENT_ALERT_KINDS = ['STATEMENT_AWAITING_REVIEW', 'STATEMENT_AWAITING_APPROVAL'] as const;
const REFUSED_ROLE = 'branch_manager';

/**
 * ينضّف قواعد التنبيه المخزنة اللي فيها دور مرفوض للنوع (issue #486، AL-Q7 = PP-29.1): بيشيل مدير الفرع من
 * قواعد تنبيهات كشف العمولات ويسيب باقي حقول القاعدة زي ما هي. قاعدة بقت من غير أي دور بتفضل قاعدة سليمة
 * (الـ validator والـ CHECK بيقبلوا قايمة فاضية)، والأدوار الفاضية معناها إن القاعدة مابتختارش مستلمين بالدور؛
 * ما بنخترعش بديل. كل قاعدة اتغيّرت بتزوّد revision وبيتكتب لها سطر تدقيق واحد بهوية النظام (actor_user_id فاضي).
 * كل شركة بتشتغل داخل withTenant على pospay_app وقاعدتها مقفولة قبل التعديل، فالإعادة ما بتلاقي حاجة تغيّرها
 * والخطوة idempotent، وشركة تانية مابتتلمسش. الخطوة مبنية على ADR-0038؛ مالك الترحيل بيقرأ معرفات الشركات فقط.
 * بتشتغل بعد ما migration 0245 ضافت القيد NOT VALID: تعديلها بيشيل الدور فصفّها الجديد بيحقق القيد، وكاتب قديم مايقدرش
 * يرجّع الدور بين الخطوة والـ VALIDATE.
 *
 * @param owner اتصال الترحيل لاكتشاف معرفات الشركات فقط
 * @param app واجهة التطبيق المقيدة بعزل الشركات
 * @param ids مولّد المعرفات لسطور التدقيق
 * @returns أعداد الشركات والقواعد المقروءة والمتغيّرة دون أسماء
 */
export async function cleanStatementAlertRoles(
  owner: postgres.Sql,
  app: DataStepApp,
  ids: IdGenerator,
): Promise<StatementAlertRolesCounts> {
  const [role] = await owner<{ bypass: boolean }[]>`
    SELECT rolsuper OR rolbypassrls AS bypass FROM pg_roles WHERE rolname = current_user`;
  if (role?.bypass !== true) throw new StatementAlertRolesRoleRefusedError();
  const companies = await owner<{ id: string }[]>`SELECT id FROM companies ORDER BY id`;
  const counts = { companies: companies.length, read: 0, cleaned: 0 };
  for (const { id: companyId } of companies) {
    const result = await app.withTenant(companyId, (tx) => cleanOneCompany(tx, companyId, ids));
    counts.read += result.read;
    counts.cleaned += result.cleaned;
  }
  return counts;
}

/**
 * معاملة شركة واحدة: بتقفل قواعدها اللي فيها دور مرفوض وبتشيل الدور وبتكتب التدقيق.
 *
 * @param tx معاملة الشركة
 * @param companyId الشركة الجارية
 * @param ids مولّد المعرفات
 * @returns المقروء والمتغيّر
 */
async function cleanOneCompany(tx: Tx, companyId: string, ids: IdGenerator) {
  let cleaned = 0;
  // النوعين في استعلام واحد بترتيب kind ثم id، زي ترتيب قفل القواعد في شاشة الإعدادات: الخطوة والـ API مايقفلوش نفس الصفوف بترتيب مختلف.
  const rows = await tx.execute<RuleRow>(sql`
    SELECT id, business_id, branch_id, kind, enabled, recipient_roles, channels, delay_minutes, lead_minutes, revision
    FROM alert_rules
    WHERE company_id = ${companyId} AND kind IN (${sql.join(
      STATEMENT_ALERT_KINDS.map((kind) => sql`${kind}`),
      sql`, `,
    )}) AND ${REFUSED_ROLE}::text = ANY(recipient_roles)
    ORDER BY kind, id FOR UPDATE`);
  for (const row of rows) {
    const remaining = row.recipient_roles.filter((value) => value !== REFUSED_ROLE);
    const [updated] = await tx.execute<{ revision: number }>(sql`
      UPDATE alert_rules SET recipient_roles = array_remove(recipient_roles, ${REFUSED_ROLE}::text), revision = revision + 1, updated_at = now()
      WHERE company_id = ${companyId} AND id = ${row.id} RETURNING revision`);
    if (updated === undefined)
      throw new Error('statement alert rule vanished under its own row lock');
    cleaned += 1;
    await tx.execute(sql`
      INSERT INTO audit_log (company_id, id, actor_user_id, entity, entity_id, action, before, after)
      VALUES (${companyId}, ${ids.newId()}, NULL, 'alert_rule', ${row.branch_id ?? row.business_id},
        'alert_rule.statement_role_removed',
        ${JSON.stringify(auditShape(row, row.recipient_roles, row.revision))}::jsonb,
        ${JSON.stringify(auditShape(row, remaining, updated.revision))}::jsonb)`);
  }
  return { read: rows.length, cleaned };
}

/** نفس شكل سطر تدقيق حفظ القاعدة من شاشة الإعدادات، عشان قارئ السجل يلاقي شكل واحد. */
function auditShape(row: RuleRow, roles: readonly string[], revision: number) {
  return {
    business_id: row.business_id,
    branch_id: row.branch_id,
    kind: row.kind,
    rule: {
      enabled: row.enabled,
      recipient_roles: roles,
      channels: row.channels,
      delay_minutes: row.delay_minutes,
      lead_minutes: row.lead_minutes,
      revision,
    },
  };
}
