import {
  addUnmarkedPage,
  emptyUnmarkedTotals,
  findUnmarkedEventIds,
  type UnmarkedTotals,
} from '@pospay/commissions-engine';

import type {
  CoverageProjectionReader,
  CoverageRetainedPageReader,
  CoverageTenantRunner,
} from '../../ports/commission-coverage.port.ts';

const RETAINED_PAGE_SIZE = 100;
export const REPORT_LIST_LIMIT = 200;
// سبب رفض الحدث الذي لا يسجّل المستهلك لنوعه؛ رمز واحد يفرق بين "بانتظار 50-4" و"فجوة حقيقية".
const EVENT_TYPE_NOT_HANDLED: NotHandledEvent['reason'] = 'COMMISSION_EVENT_TYPE_NOT_HANDLED';

/** الحدث المحتفظ به كما ترجعه واجهة الأوتبوكس؛ النوع مشتق من المنفذ حتى لا يستورد الـ use case @pospay/db. */
export type RetainedEvent = Awaited<
  ReturnType<CoverageRetainedPageReader['commissionRetainedEventPage']>
>['events'][number];

/** حدث محتفظ به غير مستهلك في التقرير: هويته ونوعه بلا حمولة. */
export type UnmarkedEvent = { eventId: string; type: string };

/** حدث محتفظ به لم يسجّل المستهلك لنوعه؛ هويته ونوعه وسبب الرفض الثابت. */
export type NotHandledEvent = {
  eventId: string;
  type: string;
  reason: 'COMMISSION_EVENT_TYPE_NOT_HANDLED';
};

/** نتيجة فحص الأحداث المحتفظ بها: الحد الأعلى وهوية آخر حدث ومجموعان محدودان. */
export interface UnmarkedCheck {
  readonly throughId: string | null;
  readonly lastEventId: string | null;
  readonly totals: UnmarkedTotals<UnmarkedEvent>;
  readonly notHandled: UnmarkedTotals<NotHandledEvent>;
}

/** سياق فحص الأحداث المحتفظ بها: منافذ القراءة التي يحتاجها الفحص وشركة النطاق. */
export interface RetainedCheckContext {
  readonly deps: {
    readonly withTenant: CoverageTenantRunner;
    readonly projection: CoverageProjectionReader;
    readonly retained: CoverageRetainedPageReader;
    readonly handledTypes: ReadonlySet<string>;
    readonly consumerId: string;
  };
  readonly companyId: string;
}

/** حدث محتفظ به خارج شركة النطاق؛ الرفض يمنع نسبة حدث شركة أخرى إلى التقرير. */
export class CommissionCoverageEventInvalidError extends Error {
  readonly code = 'COMMISSION_COVERAGE_EVENT_INVALID';

  constructor() {
    super('COMMISSION_COVERAGE_EVENT_INVALID');
    this.name = 'CommissionCoverageEventInvalidError';
  }
}

/**
 * يمرّ على صفحات الأحداث المحتفظ بها ويجمع الأحداث غير المستهلكة والأنواع التي لا يسجّلها المستهلك.
 */
export async function checkUnmarked(
  context: RetainedCheckContext,
  requestedThroughId: string | null,
): Promise<UnmarkedCheck> {
  let totals = emptyUnmarkedTotals<UnmarkedEvent>();
  let notHandled = emptyUnmarkedTotals<NotHandledEvent>();
  let throughId = requestedThroughId;
  let lastEventId: string | null = null;
  let afterId: string | null = null;
  let firstPage = true;
  for (;;) {
    const page = await context.deps.retained.commissionRetainedEventPage(
      context.companyId,
      afterId,
      throughId,
      RETAINED_PAGE_SIZE,
    );
    if (firstPage) {
      throughId = page.throughId;
      firstPage = false;
    }
    if (page.events.length === 0) return { throughId, lastEventId, totals, notHandled };
    for (const event of page.events) {
      if (event.companyId.toLowerCase() !== context.companyId) {
        throw new CommissionCoverageEventInvalidError();
      }
    }
    const split = await splitRetainedPage(context, page.events);
    totals = addUnmarkedPage(totals, split.checked, split.unmarked, REPORT_LIST_LIMIT);
    notHandled = addUnmarkedPage(
      notHandled,
      split.notHandled.length,
      split.notHandled,
      REPORT_LIST_LIMIT,
    );
    const lastEvent = page.events.at(-1);
    afterId = lastEvent?.id ?? afterId;
    lastEventId = lastEvent?.id.toLowerCase() ?? lastEventId;
    if (page.events.length < RETAINED_PAGE_SIZE) {
      return { throughId, lastEventId, totals, notHandled };
    }
  }
}

/**
 * يقسم أحداث الصفحة: نوع يسجّله المستهلك يُفحص في العلامات، ونوع لا يسجّله لا يُفحص بل يُدرَج
 * بسببه الثابت حتى يفرّق المشغّل بين "بانتظار المعالج" و"فجوة تغطية حقيقية".
 */
async function splitRetainedPage(context: RetainedCheckContext, events: readonly RetainedEvent[]) {
  const handled = events.filter((event) => context.deps.handledTypes.has(event.eventType));
  const unhandled = events.filter((event) => !context.deps.handledTypes.has(event.eventType));
  const eventIds = handled.map((event) => event.id.toLowerCase());
  const marked = await context.deps.withTenant(context.companyId, (tx) =>
    context.deps.projection.markedEventIds(
      tx,
      context.companyId,
      context.deps.consumerId,
      eventIds,
    ),
  );
  const unmarkedIds = new Set(findUnmarkedEventIds(eventIds, marked));
  return {
    checked: handled.length,
    unmarked: handled
      .filter((event) => unmarkedIds.has(event.id.toLowerCase()))
      .map((event) => ({ eventId: event.id, type: event.eventType })),
    notHandled: unhandled.map((event) => ({
      eventId: event.id,
      type: event.eventType,
      reason: EVENT_TYPE_NOT_HANDLED,
    })),
  };
}
