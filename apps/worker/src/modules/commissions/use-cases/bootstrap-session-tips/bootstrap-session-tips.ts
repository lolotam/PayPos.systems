import type {
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
 * abortedAt يحمل النشاط والمؤشر الذي توقّف عنده التشغيل، فتكمل الجلسة من هناك.
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

/**
 * يقرأ الحالة الحالية للزيارات ويسقط بقشيشها على مسار المستهلك الحي، ثم يسجّل أحداثها كمستهلكة.
 * كل صفحة في معاملة واحدة، وكل جلسة داخل نقطة حفظ مستقلة، فالجلسة المرفوضة بسبب عمل معروف لا تُسقط
 * بقيّة الصفحة، وأي خطأ آخر يُلغي الصفحة ويُوقف التشغيل.
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
  for (const businessId of scope.businessIds) {
    let cursor: BootstrapTipCursor | null = null;
    for (;;) {
      let page: { sessions: number; events: number; nextCursor: BootstrapTipCursor | null };
      try {
        page = await deps.withTenant(scope.companyId, (tx) =>
          readPage(deps, scope, businessId, cursor, tx, report),
        );
      } catch (error) {
        if (error instanceof RangeError) throw error;
        return abortedResult(report, businessId, cursor);
      }
      report.sessions += page.sessions;
      report.events += page.events;
      cursor = page.nextCursor;
      if (cursor === null) break;
    }
  }
  return {
    status: report.undelivered.length === 0 ? 'COMPLETE' : 'UNDELIVERED',
    counts: { sessions: report.sessions, events: report.events },
    undelivered: report.undelivered,
    truncated: report.truncated,
    abortedAt: null,
  };
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

/** يقرأ صفحة واحدة في معاملة الشركة ويعدّ ما سُلّم فيها؛ الأعداد لا تُضاف إلا بعد ثبات الصفحة. */
async function readPage(
  deps: SessionTipsBootstrapDeps,
  scope: SessionTipsBootstrapScope,
  businessId: string,
  cursor: BootstrapTipCursor | null,
  tx: TipsBootstrapTx,
  report: BootstrapReport,
): Promise<{ sessions: number; events: number; nextCursor: BootstrapTipCursor | null }> {
  const page = await deps.reader.readPage(
    tx,
    scope.companyId,
    businessId,
    { from: scope.from, to: scope.to },
    { after: cursor, limit: PAGE_SIZE },
  );
  let sessions = 0;
  let events = 0;
  for (const session of page.items) {
    if (!(await deliverSession(deps, scope, businessId, session, tx, report))) continue;
    sessions += 1;
    events += session.eventIds.length;
  }
  return { sessions, events, nextCursor: page.nextCursor };
}

/** يسقط بقشيش الجلسة ويسجّل أحداثها في نقطة حفظ واحدة، فإما أن يتمّ الاثنان أو يُلغى الاثنان. */
async function deliverSession(
  deps: SessionTipsBootstrapDeps,
  scope: SessionTipsBootstrapScope,
  businessId: string,
  session: BootstrapTipSession,
  tx: TipsBootstrapTx,
  report: BootstrapReport,
): Promise<boolean> {
  try {
    await tx.transaction(async (sp) => {
      await deps.tipsFor(sp).execute(toTipInput(scope.companyId, businessId, session));
      for (const eventId of session.eventIds) {
        await deps.markConsumed(sp, deps.consumerId, eventId);
      }
    });
    return true;
  } catch (error) {
    const code = failureCode(error);
    if (code === null || !CONTINUABLE_CODES.has(code)) throw error;
    recordUndelivered(report, session.sessionId, businessId, code);
    return false;
  }
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

/** نتيجة الإيقاف: المؤشر يبقى آخر صفحة ثبتت، فالتشغيل كامل من نفس النقطة. */
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
