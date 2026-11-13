import type {
  BootstrapTipPage,
  BootstrapTipSession,
  CurrentTipSessionsReader,
  TipsBootstrapTenantRunner,
  TipsBootstrapTx,
} from '../../ports/commission-tip-bootstrap.port.ts';
import type { ProjectSessionTipsInput } from '../project-session-tips/project-session-tips.ts';

const PAGE_SIZE = 100;
const UNDELIVERED_LIMIT = 200;
const CONTINUABLE_CODES = new Set([
  'COMMISSION_PERIOD_CLOSED',
  'COMMISSION_BUSINESS_MISSING',
  'COMMISSION_TIP_SALARY_INPUT_INVALID',
]);

/** مؤشر صفحة الزيارات: يوم الزيارة ومعرّفها معاً. */
export interface BootstrapTipCursor {
  readonly businessDate: string;
  readonly sessionId: string;
}

/** نطاق التهيئة: شركة واحدة وأنشطة ويوم عمل. */
export interface SessionTipsBootstrapScope {
  readonly companyId: string;
  readonly businessIds: readonly string[];
  readonly from: string;
  readonly to: string;
}

/** جلسة تعذّر تسليم بقشيشها بسبب عمل معروف؛ الهوية والرمز فقط بلا مبالغ ولا موظفات. */
export interface UndeliveredTipSession {
  readonly sessionId: string;
  readonly businessId: string;
  readonly code: string;
}

/**
 * نتيجة التهيئة: حالة التشغيل وأعداد التسليم والجلسات التي تعذّر تسليمها.
 * counts.sessions هو عدد الزيارات التي ثبتت معاملتها، وcounts.events هو عدد معرّفات الأحداث
 * التي حُسمت علامةً جديدة في هذا التشغيل (العلامات التي رجعت true) لا كل الأحداث المسرودة.
 * abortedAt يحمل النشاط ومؤشر الصفحة التي كان التشغيل يعالجها؛ الزيارات التي ثبتت قبل التوقف
 * تبقى مثبّتة، وإعادة التشغيل من البداية آمنة لأن حارس المراجعة والعلامات يجعلها متكرّرة بلا أثر.
 */
export interface SessionTipsBootstrapResult {
  readonly status: 'COMPLETE' | 'UNDELIVERED' | 'ABORTED';
  readonly counts: { readonly sessions: number; readonly events: number };
  readonly undelivered: readonly UndeliveredTipSession[];
  readonly truncated: boolean;
  readonly abortedAt: {
    readonly businessId: string;
    readonly after: { readonly businessDate: string; readonly sessionId: string } | null;
  } | null;
}

/** ما يحتاجه المشغّل من الخارج: معاملة الشركة، قارئ الحالة، إسقاط البقشيش، وتسجيل الأحداث. */
export interface SessionTipsBootstrapDeps {
  readonly withTenant: TipsBootstrapTenantRunner;
  readonly reader: CurrentTipSessionsReader;
  readonly tipsFor: (tx: TipsBootstrapTx) => { execute(input: ProjectSessionTipsInput): Promise<void> };
  readonly consumerId: string;
  readonly markConsumed: (tx: TipsBootstrapTx, consumerId: string, eventId: string) => Promise<boolean>;
}

interface BootstrapReport {
  sessions: number;
  events: number;
  undelivered: UndeliveredTipSession[];
  truncated: boolean;
}

/** سياق التشغيل: الاعتماديات والنطاق الموحَّد والتقرير المشترك بين الزيارات. */
interface BootstrapRun {
  readonly deps: SessionTipsBootstrapDeps;
  readonly scope: SessionTipsBootstrapScope;
  readonly report: BootstrapReport;
}

/** نتيجة زيارة واحدة داخل التشغيل: ثبتت، أو مرفوضة بسبب معروف، أو أوقفت التشغيل. */
type SessionOutcome = 'committed' | 'undelivered' | 'aborted';

/**
 * يقرأ الحالة الحالية للزيارات ويسقط بقشيشها على مسار المستهلك الحي، ثم يسجّل أحداثها كمستهلكة.
 * كل صفحة تُقرأ في معاملة قراءة تُثبَت قبل تطبيق أي زيارة فيها، وكل زيارة تُطبَّق في معاملة
 * مستقلة: يُعلَّم كل حدث من أحداثها بترتيبه ثم يُسقط بقشيشها، فترتيب الحسم ثم القفل يطابق
 * المسار الحي فلا تتجمّد التهيئة خلف حسم حي غير مثبَّت. الزيارة المرفوضة بسبب عمل معروف
 * تُسجَّل غير مسلَّمة وتُكمل البقية، وأي خطأ آخر يوقف التشغيل بنتيجة ABORTED وتبقى كل
 * زيارة ثبتت قبله كما هي.
 *
 * @param deps معاملة الشركة وقارئ الحالة وإسقاط البقشيش ومسجّل الأحداث
 * @param scope الشركة والأنشطة ونطاق يومي العمل المطلوب تهيئته
 * @returns حالة التشغيل وأعداد التسليم والجلسات غير المسلّمة ونقطة التوقف
 */
export async function runSessionTipsBootstrap(
  deps: SessionTipsBootstrapDeps,
  scope: SessionTipsBootstrapScope,
): Promise<SessionTipsBootstrapResult> {
  const report: BootstrapReport = { sessions: 0, events: 0, undelivered: [], truncated: false };
  const run: BootstrapRun = {
    deps,
    scope: { ...scope, businessIds: normalizeBusinessIds(scope.businessIds) },
    report,
  };
  for (const businessId of run.scope.businessIds) {
    const aborted = await runBusiness(run, businessId);
    if (aborted !== null) return aborted;
  }
  return {
    status: report.undelivered.length === 0 ? 'COMPLETE' : 'UNDELIVERED',
    counts: { sessions: report.sessions, events: report.events },
    undelivered: report.undelivered,
    truncated: report.truncated,
    abortedAt: null,
  };
}

/** يمرّ على صفحات النشاط: كل صفحة تُقرأ بمعاملتها، وكل زيارة تُطبَّق بمعاملتها المستقلة. */
async function runBusiness(
  run: BootstrapRun,
  businessId: string,
): Promise<SessionTipsBootstrapResult | null> {
  let cursor: BootstrapTipCursor | null = null;
  for (;;) {
    let page: BootstrapTipPage;
    try {
      page = await readPage(run, businessId, cursor);
    } catch (error) {
      if (error instanceof RangeError) throw error;
      return abortedResult(run.report, businessId, cursor);
    }
    for (const session of page.items) {
      const outcome = await deliverSession(run, businessId, session);
      if (outcome === 'aborted') return abortedResult(run.report, businessId, cursor);
    }
    cursor = page.nextCursor;
    if (cursor === null) return null;
  }
}

/** يقرأ صفحة واحدة في معاملة قراءة مستقلة تُثبَت قبل تطبيق أي زيارة من صفحتها. */
async function readPage(
  run: BootstrapRun,
  businessId: string,
  cursor: BootstrapTipCursor | null,
): Promise<BootstrapTipPage> {
  return run.deps.withTenant(run.scope.companyId, (tx) =>
    run.deps.reader.readPage(
      tx,
      run.scope.companyId,
      businessId,
      { from: run.scope.from, to: run.scope.to },
      { after: cursor, limit: PAGE_SIZE },
    ),
  );
}

/**
 * يطبّق زيارة واحدة في معاملة مستقلة: يعلّم كل أحداثها بالترتيب ثم يسقط بقشيشها.
 * الحسم قبل القفل يطابق المسار الحي، والعلامة والإسقاط في معاملة واحدة فإما أن يتمّ الاثنان
 * أو يُلغى الاثنان.
 *
 * @param run سياق التشغيل: الاعتماديات والنطاق والتقرير
 * @param businessId النشاط الذي تنتمي إليه الزيارة
 * @param session الزيارة كما قرأها القارئ
 * @returns نتيجة الزيارة: ثبتت، أو مرفوضة بسبب معروف، أو أوقفت التشغيل
 */
async function deliverSession(
  run: BootstrapRun,
  businessId: string,
  session: BootstrapTipSession,
): Promise<SessionOutcome> {
  let claimed = 0;
  try {
    await run.deps.withTenant(run.scope.companyId, async (tx) => {
      for (const eventId of session.eventIds) {
        if (await run.deps.markConsumed(tx, run.deps.consumerId, eventId)) claimed += 1;
      }
      await run.deps.tipsFor(tx).execute(toTipInput(run.scope.companyId, businessId, session));
    });
  } catch (error) {
    const code = failureCode(error);
    if (code === null || !CONTINUABLE_CODES.has(code)) return 'aborted';
    recordUndelivered(run.report, session.sessionId, businessId, code);
    return 'undelivered';
  }
  run.report.sessions += 1;
  run.report.events += claimed;
  return 'committed';
}

/** يحوّل جلسة البقشيش المقروءة من الحالة الحالية إلى مدخل إسقاط الجلسة، بلا قراءة ولا كتابة. */
function toTipInput(
  companyId: string,
  businessId: string,
  session: BootstrapTipSession,
): ProjectSessionTipsInput {
  return {
    companyId,
    businessId,
    branchId: session.branchId,
    sessionId: session.sessionId,
    businessDate: session.businessDate,
    revision: session.revision,
    tips: session.tips.map((tip) => ({
      employeeId: tip.employeeId,
      method: tip.method,
      amount: tip.amount,
    })),
  };
}

/** يسجّل الجلسة غير المسلّمة حتى حد السقف، وبعده يبقى الباقي محذوفاً لأن التقرير لا يتضخّم بلا حد. */
function recordUndelivered(
  report: BootstrapReport,
  sessionId: string,
  businessId: string,
  code: string,
): void {
  if (report.undelivered.length >= UNDELIVERED_LIMIT) {
    report.truncated = true;
    return;
  }
  report.undelivered.push({ sessionId, businessId, code });
}

function failureCode(error: unknown): string | null {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === 'string') return code;
  }
  return null;
}

/** نتيجة الإيقاف: المؤشر هو مؤشر الصفحة التي كان التشغيل يعالجها؛ وما ثبت قبلها يبقى مثبَّتاً. */
function abortedResult(
  report: BootstrapReport,
  businessId: string,
  after: BootstrapTipCursor | null,
): SessionTipsBootstrapResult {
  return {
    status: 'ABORTED',
    counts: { sessions: report.sessions, events: report.events },
    undelivered: report.undelivered,
    truncated: report.truncated,
    abortedAt: { businessId, after },
  };
}

/**
 * يوحّد معرّفات الأنشطة: حروف صغيرة بلا تكرار، وبالترتيب الذي وردت به.
 *
 * @param ids معرّفات الأنشطة كما وردت من المشغّل
 * @returns المعرّفات الموحَّدة بلا تكرار وبالترتيب نفسه
 */
export function normalizeBusinessIds(ids: readonly string[]): string[] {
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const id of ids) {
    const normalized = id.toLowerCase();
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    unique.push(normalized);
  }
  return unique;
}
