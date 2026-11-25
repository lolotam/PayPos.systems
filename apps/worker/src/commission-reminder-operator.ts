/**
 * متطلبات مشغّل استعادة جدولة التذكيرات (ADR-0061 §7، البند 8 من #1222): قبل ما يلمس أي
 * جدولة أو مفتاح Redis أو علامة، يتأكد إن دالة قراءة الشركات موجودة ومملوكة للدور الصح،
 * وإن سياسة RLS على `companies` موجودة، وإن نداء الدالة ينجح. لو أي شرط مش متحقق، بيقف
 * فورًا بكود خطأ ثابت ومن غير أي أثر.
 */

/** استعلام واحد: النص الثابت والنتيجة. */
export type OperatorQuery = (
  text: string,
) => Promise<readonly Record<string, unknown>[]>;

/** كود الفحص: دالة قراءة الشركات ناقصة أو مملوكة لدور تاني. */
export const RECOVERY_FUNCTION_MISSING = 'COMMISSION_REMINDER_RECOVERY_FUNCTION_MISSING';
/** كود الفحص: سياسة RLS على `companies` ناقصة. */
export const RECOVERY_POLICY_MISSING = 'COMMISSION_REMINDER_RECOVERY_POLICY_MISSING';
/** كود الفحص: نداء الدالة نفسها فشل. */
export const RECOVERY_PROBE_FAILED = 'COMMISSION_REMINDER_RECOVERY_PROBE_FAILED';

const PREREQUISITE_QUERY = `SELECT
  EXISTS (SELECT 1 FROM pg_proc p JOIN pg_roles r ON r.oid = p.proowner
    WHERE p.oid = pg_catalog.to_regprocedure('public.recovery_company_ids(uuid, integer)')
      AND r.rolname = 'pospay_recovery_company_reader'
      AND pg_catalog.has_function_privilege('pospay_dispatcher', p.oid, 'EXECUTE')) AS function_ok,
  EXISTS (SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'companies'
      AND policyname = 'companies_recovery_select') AS policy_ok`;

const PROBE_QUERY = 'SELECT id FROM public.recovery_company_ids(NULL::uuid, 1)';

/**
 * يتحقق من متطلبات الدالة والسياسة قبل أي أثر، ويجرّب الفحص على دور المرسّل الفعلي إن مُرّر.
 *
 * @param query استعلام واحد ينفّذ النص الثابت على اتصال القاعدة
 * @param probe فحص اختياري بدور `pospay_dispatcher` الفعلي
 * @returns null لو كل الشروط متحققة، أو كود الخطأ الثابت
 */
export async function checkRecoveryPrerequisites(
  query: OperatorQuery,
  probe?: () => Promise<unknown>,
): Promise<string | null> {
  const rows = await query(PREREQUISITE_QUERY);
  const row = rows[0];
  if (row?.['function_ok'] !== true) return RECOVERY_FUNCTION_MISSING;
  if (row?.['policy_ok'] !== true) return RECOVERY_POLICY_MISSING;
  try {
    await (probe ? probe() : query(PROBE_QUERY));
  } catch {
    return RECOVERY_PROBE_FAILED;
  }
  return null;
}
