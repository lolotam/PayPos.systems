import type { Tx } from '@pospay/db';
import { moneyToString } from '@pospay/domain';
import { sql, type SQL } from 'drizzle-orm';

import type { Clock, IdGenerator } from '../ports/commission-line-projection.port.ts';
import type {
  CommissionCorrectionInsertInput,
  CommissionGenerationInput,
} from '../ports/commission-correction.port.ts';

/**
 * يبني مصفوفة uuid كقيمة SQL مكتوبة مش كمعامل مربوط: الدريزل بيوسّع أي مصفوفة
 * جوه sql لعناصر مفصولة بفاصلة، فالمصفوفة الفاضية بتبقى استدعاء مش صالح.
 */
function uuidArraySql(list: readonly string[]): SQL {
  if (list.length === 0) return sql`'{}'::uuid[]`;
  return sql`ARRAY[${sql.join(
    list.map((id) => sql`${id}::uuid`),
    sql`, `,
  )}]::uuid[]`;
}

type GenerationRow = { generation: number };

/**
 * يرفع جيل تصحيحات الموظفة في الشهر: جيل واحد لو الصف غايب، وجيل زائد لو موجود.
 * الكتابة ذرّية، فالمعاملتان على نفس الموظفة والشهر ما بياخدوش نفس الرقم.
 *
 * @param tx معاملة withTenant الحالية؛ الأقفال جواها مش بتتضاف
 * @param ids مولّد هويات الصفوف المحقون
 * @param input النشاط والموظفة والشهر
 * @returns رقم الجيل الجديد
 */
export async function bumpGeneration(
  tx: Tx,
  ids: IdGenerator,
  input: CommissionGenerationInput,
): Promise<number> {
  const rows = await tx.execute<GenerationRow>(sql`INSERT INTO commission_period_generations(
    company_id,id,business_id,employee_id,period,generation)
    VALUES (app_company_id(),${ids.newId()}::uuid,${input.businessId}::uuid,
      ${input.employeeId}::uuid,${input.period},1)
    ON CONFLICT (company_id,employee_id,period)
    DO UPDATE SET generation = commission_period_generations.generation + 1
    RETURNING generation`);
  const row = rows[0];
  if (row === undefined) {
    throw new Error('the commission period generation row is missing after its upsert');
  }
  return row.generation;
}

/**
 * يكتب صفوف التصحيح المحسوبة دفعة واحدة؛ الصف تُضاف بس وما بتتعدّلش بعد كده (FR-040).
 *
 * @param tx معاملة withTenant الحالية؛ ما ينفع تفتح معاملة تانية
 * @param ids مولّد هويات الصفوف المحقون
 * @param clock ساعة اللحظة الحالية المحقونة
 * @param input النشاط والمسودات المحسوبة
 */
export async function insertCorrections(
  tx: Tx,
  ids: IdGenerator,
  clock: Clock,
  input: CommissionCorrectionInsertInput,
): Promise<void> {
  if (input.drafts.length === 0) return;
  const createdAt = clock.now().toISOString();
  await tx.execute(sql`INSERT INTO commission_corrections(
    company_id,id,business_id,employee_id,source_period,target_period,target_statement_id,source_ref,
    kind,amount,previous_amount,new_amount,generation,event_id,created_at,source_branch_id,
    source_business_date,attached_branch_ids)
    VALUES ${sql.join(
      input.drafts.map(
        (draft) => sql`(
      app_company_id(),${ids.newId()}::uuid,${input.businessId}::uuid,${draft.employeeId}::uuid,
      ${draft.sourcePeriod},${draft.targetPeriod},${draft.targetStatementId}::uuid,${draft.sourceRef},
      ${draft.kind},${moneyToString(draft.amount)},${moneyToString(draft.previousAmount)},
      ${moneyToString(draft.newAmount)},${draft.generation},${draft.eventId}::uuid,
      ${createdAt}::timestamptz,${draft.attribution.sourceBranchId}::uuid,
      ${draft.attribution.sourceBusinessDate}::date,
      ${uuidArraySql(draft.attribution.attachedBranchIds)})`,
      ),
      sql`, `,
    )}`);
}
