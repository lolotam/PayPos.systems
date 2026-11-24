import postgres from 'postgres';

/** رفض متوقع لإصدار إثبات التغطية؛ الرمز وحده آمن للطباعة بلا SQL أو بيانات اتصال. */
export class CoverageIssuanceError extends Error {
  override readonly name = 'CoverageIssuanceError';
  readonly code: string;
  constructor(code: string) {
    super(code);
    this.code = code;
  }
}

/** لقطة قاعدة الإصدار قبل التقرير؛ الساعة من PostgreSQL وليست من جهاز المشغّل. */
export interface CoverageIssuanceSnapshot {
  readonly generation: string;
  readonly databaseName: string;
  readonly systemId: string;
  readonly tipBound: string;
}

/** دليل التقرير الذي تقبله الدالة المحدودة؛ لا يصل للمتصل أي عميل SQL. */
export interface CoverageIssuanceProof {
  readonly proofId: string;
  readonly version: number;
  readonly businessIds: readonly string[];
  readonly tipFrom: string;
  readonly tipTo: string;
  readonly throughId: string | null;
  readonly runId: string;
  readonly release: string;
}

/** قدرة إصدار ضيقة على dispatcher؛ التحقق الفاشل والتجربة الجافة يتراجعان حتى عن صف ensure. */
export interface CoverageIssuer {
  /** يتحقق أولاً ثم يصدر مرة واحدة؛ null تعني تجربة جافة بلا كتابة. */
  verifyAndIssue<T>(
    companyId: string,
    stateId: string,
    verify: (
      snapshot: CoverageIssuanceSnapshot,
    ) => Promise<{ result: T; proof: CoverageIssuanceProof | null }>,
  ): Promise<{ result: T; generation: string | null }>;
  /** يغلق الاتصال الخاص بالأمر. */
  close(): Promise<void>;
}

class DryRunResult<T> {
  readonly result: T;
  constructor(result: T) {
    this.result = result;
  }
}

/** يترجم رفض الدالة المتوقع دون تسريب نص PostgreSQL أو رابط الاتصال. */
export function coverageIssuanceFailure(error: unknown): CoverageIssuanceError {
  if (error instanceof CoverageIssuanceError) return error;
  const message = error instanceof Error ? error.message : '';
  return new CoverageIssuanceError(
    /^COVERAGE_[A-Z_]+$/.test(message) ? message : 'COVERAGE_ISSUANCE_FAILED',
  );
}

/** يربط دوال 0250 حصراً بدور dispatcher؛ لا منح جديدة ولا وصول مباشر لجدولي الإثبات. */
export function createCoverageIssuer(url: string): CoverageIssuer {
  const client = postgres(url, { max: 1, onnotice: () => undefined });
  return {
    verifyAndIssue: async <T>(
      companyId: string,
      stateId: string,
      verify: (
        snapshot: CoverageIssuanceSnapshot,
      ) => Promise<{ result: T; proof: CoverageIssuanceProof | null }>,
    ) => {
      try {
        return await client.begin(async (tx) => {
          await assertDispatcher(tx);
          const [row] =
            await tx`SELECT out_generation::text, out_database_name, out_system_id::text,
            ((clock_timestamp() AT TIME ZONE 'UTC')::date + 1)::text AS tip_bound
            FROM public.current_commission_coverage_generation(${companyId}::uuid, ${stateId}::uuid)`;
          if (row === undefined) throw new CoverageIssuanceError('COVERAGE_GENERATION_MOVED');
          const snapshot = {
            generation: String(row['out_generation']),
            databaseName: String(row['out_database_name']),
            systemId: String(row['out_system_id']),
            tipBound: String(row['tip_bound']),
          };
          const checked = await verify(snapshot);
          if (checked.proof === null) throw new DryRunResult(checked.result);
          const generation = await issue(tx, companyId, snapshot, checked.proof);
          return { result: checked.result, generation };
        });
      } catch (error) {
        if (error instanceof DryRunResult) return { result: error.result as T, generation: null };
        throw coverageIssuanceFailure(error);
      }
    },
    close: () => client.end(),
  };
}

async function assertDispatcher(tx: postgres.TransactionSql): Promise<void> {
  const [row] = await tx`SELECT current_user AS role, rolsuper OR rolbypassrls AS privileged
    FROM pg_roles WHERE rolname = current_user`;
  if (row?.['role'] !== 'pospay_dispatcher' || row['privileged'] !== false)
    throw new CoverageIssuanceError('COVERAGE_DISPATCHER_REQUIRED');
}

async function issue(
  tx: postgres.TransactionSql,
  companyId: string,
  snapshot: CoverageIssuanceSnapshot,
  proof: CoverageIssuanceProof,
): Promise<string> {
  const [row] = await tx`SELECT public.issue_commission_coverage_proof(
    ${companyId}::uuid, ${proof.proofId}::uuid, ${snapshot.generation}::bigint, ${proof.version},
    ${[...proof.businessIds]}::uuid[], ${proof.tipFrom}::date, ${proof.tipTo}::date, ${snapshot.tipBound}::date,
    ${proof.throughId}::uuid, ${snapshot.databaseName}, ${snapshot.systemId}::bigint,
    ${proof.runId}, ${proof.release})::text AS generation`;
  if (row === undefined) throw new CoverageIssuanceError('COVERAGE_GENERATION_MOVED');
  return String(row['generation']);
}
