import type { Tx } from '@pospay/db';
import {
  COMMISSION_COVERAGE_PROOF_VERSION,
  COMMISSION_INPUT_EVENT_TYPES,
  COMMISSION_INPUTS_CONSUMER_ID,
} from '@pospay/domain';
import { sql } from 'drizzle-orm';

import type { StoredCoverageProof } from '../domain/coverage-proof.ts';
import type { CoverageGateRead } from '../ports/commission-statement-approve.port.ts';

/** مفتاح الاعتماد الصريح للشركة (ADR-0054 §9): override بهذا الاسم وبلا رجوع للباقة. */
export const APPROVAL_SWITCH_FLAG = 'commission_statement_approval';

interface GateRow extends Record<string, unknown> {
  readonly out_version: number;
  readonly out_business_ids: string[];
  readonly out_tip_from: string;
  readonly out_tip_to: string;
  readonly out_tip_day_bound: string;
  readonly out_counted_types: string[];
  readonly out_consumer_id: string;
  readonly out_database_name: string;
  readonly out_system_id: string;
}

/** قراءة مفتاح الاعتماد الصريح، يربطها الجذر من identity. */
export type ExplicitFeatureReader = (
  tx: Tx,
  companyId: string,
  flag: string,
  decisionAt: Date,
) => Promise<boolean>;

/**
 * بوابة التغطية تحت قفل صف الحالة (ADR-0054 §7 الخطوة 5): دالة الـdefiner تضمن صف الحالة وتأخذه FOR SHARE إلى نهاية
 * المعاملة ثم ترجّع الإثبات الحالي أو لا شيء، وبعدها بعبارة مستقلة يُقرأ مفتاح الاعتماد فيرى ما التزم به أمر المشغّل،
 * وأخيرًا هوية قاعدة البيانات الحالية للمقارنة. لحظة قرار المفتاح (انتهاء الـoverride) تُؤخذ بعد القفل وبنفس مصدر الساعة
 * `clock_timestamp()` الذي يقيس به فحص الصلاحية، فلا يفتح الاعتماد مفتاحٌ انتهى أثناء الانتظار. الدالة لا ترفض شيئًا؛ القرار كله في حالة الاستخدام.
 *
 * @param tx معاملة الاعتماد بسياق الشركة
 * @param companyId الشركة المؤكدة
 * @param stateId معرّف يُستعمل لو لم يوجد صف حالة بعد (يُلغى مع المعاملة لو رُفض الاعتماد)
 * @param readSwitch قارئ المفتاح الصريح من identity
 * @returns الإثبات ومفتاح الاعتماد وثوابت المقارنة
 */
export async function readApprovalCoverageGate(
  tx: Tx,
  companyId: string,
  stateId: string,
  readSwitch: ExplicitFeatureReader,
): Promise<CoverageGateRead> {
  const rows = await tx.execute<GateRow>(
    sql`SELECT out_version, out_business_ids, out_tip_from::text AS out_tip_from, out_tip_to::text AS out_tip_to,
      out_tip_day_bound::text AS out_tip_day_bound, out_counted_types, out_consumer_id, out_database_name,
      out_system_id::text AS out_system_id FROM public.read_commission_coverage_gate(${stateId}::uuid)`,
  );
  const [decision] = await tx.execute<{ at: Date }>(sql`SELECT clock_timestamp() AS at`);
  if (decision === undefined) throw new Error('The database clock is unavailable');
  const switchEnabled = await readSwitch(tx, companyId, APPROVAL_SWITCH_FLAG, new Date(decision.at));
  const [identity] = await tx.execute<{ database_name: string; system_id: string }>(
    sql`SELECT pg_catalog.current_database()::text AS database_name, public.pospay_system_id()::text AS system_id`,
  );
  if (identity === undefined) throw new Error('The database identity is unavailable');
  const row = rows[0];
  return {
    proof: row === undefined ? null : proofOf(row),
    switchEnabled,
    expected: {
      version: COMMISSION_COVERAGE_PROOF_VERSION,
      countedTypes: COMMISSION_INPUT_EVENT_TYPES,
      consumerId: COMMISSION_INPUTS_CONSUMER_ID,
      databaseName: identity.database_name,
      systemId: identity.system_id,
    },
  };
}

function proofOf(row: GateRow): StoredCoverageProof {
  return {
    version: row.out_version,
    businessIds: row.out_business_ids,
    tipFrom: row.out_tip_from,
    tipTo: row.out_tip_to,
    tipDayBound: row.out_tip_day_bound,
    countedTypes: row.out_counted_types,
    consumerId: row.out_consumer_id,
    databaseName: row.out_database_name,
    systemId: String(row.out_system_id),
  };
}
