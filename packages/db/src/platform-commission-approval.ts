import {
  COMMISSION_COVERAGE_PROOF_VERSION,
  COMMISSION_INPUT_EVENT_TYPES,
  COMMISSION_INPUTS_CONSUMER_ID,
} from '@pospay/domain';
import postgres from 'postgres';

import { CoverageIssuanceError } from './commission-coverage-issuer.ts';
import type { IdGenerator } from './with-tenant.ts';

const FLAG = 'commission_statement_approval';

/** مدخل أمر المشغّل؛ البريد لحل الهوية فقط ولا يُكتب في التدقيق. */
export interface CommissionApprovalSwitchRequest {
  readonly companyId: string;
  readonly operatorEmail: string;
  readonly reason: string;
  readonly enabled: boolean;
  readonly expiresAt?: Date;
}

/** يرفض الشركة المجهولة قبل ensure كي لا يترك الأمر أثراً لشركة غير موجودة. */
async function assertCompany(tx: postgres.TransactionSql, companyId: string): Promise<void> {
  const rows =
    await tx`SELECT id FROM companies WHERE id = ${companyId} AND deleted_at IS NULL FOR SHARE`;
  if (rows.length !== 1) throw new CoverageIssuanceError('COVERAGE_COMPANY_NOT_FOUND');
}

/**
 * بيفضّل هوية المشغّل من البريد بمطابلة حالة الأحرف الأدنى فقط، فيرفض تطابقاً غامضاً بين مستخدمين
 * يختلفان بالحالة، ولا يقبل إلا مستخدماً يملك منحة منصة سارية بنفس شرط جلسات المنصة
 * (platform_grants بلا سحب وبلا انتهاء). يُستدعى بعد قفل صف الحالة: منحة تُسحب أثناء انتظار
 * القفل تُرى هنا، ورفضه يرجّع المعاملة كلها فلا يبقى صف ensure ولا bump ولا سطر تدقيق.
 */
async function assertPlatformOperator(tx: postgres.TransactionSql, email: string): Promise<string> {
  const operators =
    await tx`SELECT id FROM "user" WHERE lower(email) = ${email.toLowerCase()} ORDER BY id`;
  if (operators.length > 1) throw new CoverageIssuanceError('COVERAGE_OPERATOR_AMBIGUOUS');
  const [operator] = operators;
  if (operator === undefined) throw new CoverageIssuanceError('COVERAGE_OPERATOR_NOT_FOUND');
  const operatorId = String(operator['id']);
  const [grant] = await tx`SELECT id FROM platform_grants WHERE user_id = ${operatorId}
    AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > now()) LIMIT 1`;
  if (grant === undefined) throw new CoverageIssuanceError('COVERAGE_OPERATOR_NOT_PLATFORM');
  return operatorId;
}

/**
 * يرفض تاريخ انتهاء فائتاً بساعة قاعدة البيانات نفسها لا بساعة جهاز المشغّل؛ يُستدعى بعد قفل صف
 * الحالة وقبل أي bump أو upsert أو سطر تدقيق، فيبقى الرفض بلا أي أثر مكتوب.
 */
async function assertFutureExpiry(tx: postgres.TransactionSql, expiresAt: Date): Promise<void> {
  const [clock] = await tx`SELECT clock_timestamp() > ${expiresAt} AS past`;
  if (clock?.['past'] === true) throw new CoverageIssuanceError('COVERAGE_EXPIRY_IN_PAST');
}

/**
 * يفتح أو يقفل الاعتماد في معاملة operator واحدة مثل platform:grant، مع bump قبل تغيير المفتاح؛
 * المشغّل لازم يملك منحة منصة سارية، وتاريخ الانتهاء لازم يبقى مستقبلياً بساعة قاعدة البيانات.
 */
export async function setCommissionApprovalSwitch(
  ownerUrl: string,
  request: CommissionApprovalSwitchRequest,
  ids: IdGenerator,
): Promise<void> {
  if (!request.operatorEmail.trim() || !request.reason.trim())
    throw new CoverageIssuanceError('COVERAGE_OPERATOR_INPUT_INVALID');
  if (request.expiresAt !== undefined && Number.isNaN(request.expiresAt.getTime()))
    throw new CoverageIssuanceError('COVERAGE_OPERATOR_INPUT_INVALID');
  const client = postgres(ownerUrl, { max: 1, onnotice: () => undefined });
  try {
    await client.begin(async (tx) => {
      await assertCompany(tx, request.companyId);
      await tx`INSERT INTO commission_coverage_state (company_id, id) VALUES (${request.companyId}, ${ids.newId()})
        ON CONFLICT (company_id) DO NOTHING`;
      await tx`SELECT id FROM commission_coverage_state WHERE company_id = ${request.companyId} FOR UPDATE`;
      // حل هوية المشغّل وفحص منحته بعد قفل صف الحالة: منحة تُسحب بينما الأمر ينتظر القفل
      // خلف معاملة أخرى لابد أن تُرى هنا، قبل أي bump أو upsert أو سطر تدقيق.
      const operatorId = await assertPlatformOperator(tx, request.operatorEmail);
      if (request.expiresAt !== undefined) await assertFutureExpiry(tx, request.expiresAt);
      await tx`UPDATE commission_coverage_state SET generation = generation + 1,
        bumped_at = clock_timestamp(), reason = 'SWITCH' WHERE company_id = ${request.companyId}`;
      await tx`INSERT INTO company_feature_overrides (company_id, flag, enabled, reason, set_by, set_at, expires_at)
        VALUES (${request.companyId}, ${FLAG}, ${request.enabled}, ${request.reason}, ${operatorId}, clock_timestamp(),
          ${request.expiresAt ?? null}) ON CONFLICT (company_id, flag) DO UPDATE SET enabled = EXCLUDED.enabled,
          reason = EXCLUDED.reason, set_by = EXCLUDED.set_by, set_at = EXCLUDED.set_at, expires_at = EXCLUDED.expires_at`;
      await tx`INSERT INTO platform_audit_log (id, actor, action, target_user_id, details)
        VALUES (${ids.newId()}, ${`user:${operatorId}`},
          ${request.enabled ? 'commissions.approval_enabled' : 'commissions.approval_disabled'}, NULL,
          ${tx.json({ company_id: request.companyId, reason: request.reason, operator_user_id: operatorId })})`;
    });
  } finally {
    await client.end();
  }
}

/** يعرض المفتاح والإثبات في لقطة قراءة واحدة بلا ensure أو bump أو تسريب بيانات أشخاص. */
export async function showCommissionApprovalSwitch(ownerUrl: string, companyId: string) {
  const client = postgres(ownerUrl, { max: 1, onnotice: () => undefined });
  try {
    return await client.begin('isolation level repeatable read read only', async (tx) => {
      const rows =
        await tx`SELECT id FROM companies WHERE id = ${companyId} AND deleted_at IS NULL`;
      if (rows.length !== 1) throw new CoverageIssuanceError('COVERAGE_COMPANY_NOT_FOUND');
      const [row] = await tx`SELECT
        EXISTS (SELECT 1 FROM company_feature_overrides WHERE company_id = ${companyId} AND flag = ${FLAG}
          AND enabled AND (expires_at IS NULL OR expires_at > clock_timestamp())) AS switch_enabled,
        s.generation::text AS generation, p.version, p.tip_from::text, p.tip_to::text,
        p.tip_day_bound::text, p.report_through_id, p.verified_through_id,
        p.id IS NOT NULL AND p.version = public.commission_coverage_required_version()
          AND p.version = ${COMMISSION_COVERAGE_PROOF_VERSION} AND p.consumer_id = ${COMMISSION_INPUTS_CONSUMER_ID}
          AND p.counted_types @> ${[...COMMISSION_INPUT_EVENT_TYPES]}::text[]
          AND p.counted_types <@ ${[...COMMISSION_INPUT_EVENT_TYPES]}::text[]
          AND p.database_name = current_database() AND p.system_id = public.pospay_system_id() AS proof_current
        FROM (SELECT 1) anchor LEFT JOIN commission_coverage_state s ON s.company_id = ${companyId}
        LEFT JOIN commission_coverage_proofs p ON p.company_id = s.company_id AND p.generation = s.generation`;
      return {
        ...row,
        status:
          row?.['switch_enabled'] !== true
            ? 'SWITCH_OFF'
            : row['proof_current'] !== true
              ? 'SWITCH_ON_NO_CURRENT_PROOF'
              : 'SWITCH_ON_CURRENT_PROOF',
      };
    });
  } finally {
    await client.end();
  }
}
