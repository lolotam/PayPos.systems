import type { ClaimedEvent, DeliveryOutcome } from '@pospay/db';
import { COMMISSION_INPUT_EVENT_TYPES } from '@pospay/domain';
import { describe, expect, it, vi } from 'vitest';

import { type CommissionFailureCodes } from '../jobs/replay-commission-inputs.ts';
import { runCommissionInputReplay } from '../index.ts';

const COMPANY = '01920000-0000-7000-8000-0000000000a0';
const eventId = (n: number) => `01970000-0000-7000-8000-${String(n).padStart(12, '0')}`;

// الأنواع الستة التي يسجّلها المستهلك من 50-4؛ من @pospay/domain مباشرةً عشان تفضل قائمة واحدة.
const HANDLED_SIX: ReadonlySet<string> = new Set<string>(COMMISSION_INPUT_EVENT_TYPES);
// مجموعة أضيق افتراضية لتدريب حارس الـ runner على نوع غير مسجَّل؛ المستهلك الحقيقي يسجّل الستة كلها.
const HANDLED_BEFORE_50_4 = new Set([...HANDLED_SIX].filter((type) => type !== 'PackageSaleChanged'));

function fakeEvent(n: number, eventType: string): ClaimedEvent {
  return {
    companyId: COMPANY,
    id: eventId(n),
    aggregateType: 'service_session',
    aggregateId: eventId(n),
    eventType,
    payload: { sensitive: 'should-never-leak', n },
    attempt: 1,
  };
}

function fakeReader(events: readonly ClaimedEvent[]) {
  const page = async (
    companyId: string,
    afterId: string | null,
    throughId: string | null,
    limit: number,
  ) => {
    const companyEvents = events.filter((e) => e.companyId === companyId);
    const resolvedThroughId = throughId ?? companyEvents.at(-1)?.id ?? null;
    if (resolvedThroughId === null) return { throughId: null, events: [] };
    const filtered = companyEvents.filter(
      (e) => (afterId === null || e.id > afterId) && e.id <= resolvedThroughId,
    );
    return { throughId: resolvedThroughId, events: filtered.slice(0, limit) };
  };
  // الواجهة الثانية موجودة لأن نوع التبعيات يطلبها؛ نطاق الأربعة لا يستدعيها.
  return {
    commissionInputReplayPage: vi.fn(page),
    commissionRetainedEventPage: vi.fn(page),
  };
}

const delivered = (): Promise<DeliveryOutcome> => Promise.resolve({ delivered: true });

describe('runCommissionInputReplay: a type the consumer does not handle', () => {
  it('lists it as undelivered with the fixed code and never delivers it', async () => {
    // حارس الـ runner على مجموعة أضيق افتراضية: نوع لا يسجّله المستهلك لا يُسلَّم أصلاً؛
    // يُدرج برمز ثابت ومؤشر الاستئناف يتوقف قبله. المستهلك الحقيقي من 50-4 يسجّل الستة كلها.
    const events = [
      fakeEvent(1, 'ServiceSessionRecorded'),
      fakeEvent(2, 'PackageSaleChanged'),
      fakeEvent(3, 'SalaryChanged'),
    ];
    const reader = fakeReader(events);
    const deliver = vi.fn(delivered);

    const result = await runCommissionInputReplay(
      { reader, deliver, failures: new Map(), scope: 'SIX_TYPE', handledTypes: HANDLED_BEFORE_50_4 },
      { companyId: COMPANY, afterId: null, throughId: null },
    );

    expect(result.status).toBe('UNDELIVERED');
    expect(result.status).not.toBe('COMPLETE');
    expect(result.undelivered).toEqual([
      {
        eventId: eventId(2),
        type: 'PackageSaleChanged',
        code: 'COMMISSION_EVENT_TYPE_NOT_HANDLED',
      },
    ]);
    expect(deliver).toHaveBeenCalledTimes(2);
    expect(deliver).not.toHaveBeenCalledWith(expect.objectContaining({ id: eventId(2) }));
    expect(result.counts).toEqual({ ServiceSessionRecorded: 1, SalaryChanged: 1 });
    expect(result.afterId).toBe(eventId(1));
    expect(result.handledThroughId).toBe(eventId(3));
    expect(result.throughId).toBe(eventId(3));
    expect(result.truncated).toBe(false);
  });

  it('delivers a retained sale event to the registered consumer and ends COMPLETE', async () => {
    // تسجيل نوع البيع في المستهلك من 50-4 يخلّي نفس الصف يتسلّم ويتقفل بلا تغيير في الـ runner (CS-Q51)
    const events = [fakeEvent(1, 'ServiceSessionRecorded'), fakeEvent(2, 'PackageSaleChanged')];
    const reader = fakeReader(events);
    const deliver = vi.fn(delivered);

    const result = await runCommissionInputReplay(
      {
        reader,
        deliver,
        failures: new Map(),
        scope: 'SIX_TYPE',
        handledTypes: HANDLED_SIX,
      },
      { companyId: COMPANY, afterId: null, throughId: null },
    );

    expect(result.status).toBe('COMPLETE');
    expect(result.undelivered).toEqual([]);
    expect(result.counts).toEqual({ ServiceSessionRecorded: 1, PackageSaleChanged: 1 });
    expect(deliver).toHaveBeenCalledTimes(2);
    expect(result.afterId).toBe(eventId(2));
  });
});

describe('runCommissionInputReplay: the six-type page and the four-type default', () => {
  it('reads the six counted types through the retained page and never the four-type page', async () => {
    // الأنواع الستة لها واجهة وفهرس خاصين؛ واجهة الأنواع الأربعة لا تُستدعى في هذا النطاق
    const events = [
      fakeEvent(1, 'ServiceSessionRecorded'),
      fakeEvent(2, 'ServiceSessionLinesAdded'),
      fakeEvent(3, 'ServiceLineChanged'),
      fakeEvent(4, 'SessionTipsChanged'),
      fakeEvent(5, 'SalaryChanged'),
      fakeEvent(6, 'PackageSaleChanged'),
    ];
    const reader = fakeReader(events);
    const deliver = vi.fn(delivered);

    const result = await runCommissionInputReplay(
      {
        reader,
        deliver,
        failures: new Map(),
        scope: 'SIX_TYPE',
        handledTypes: HANDLED_SIX,
      },
      { companyId: COMPANY, afterId: null, throughId: null },
    );

    expect(reader.commissionRetainedEventPage).toHaveBeenCalledTimes(1);
    expect(reader.commissionInputReplayPage).not.toHaveBeenCalled();
    expect(result.status).toBe('COMPLETE');
    expect(result.counts).toEqual({
      ServiceSessionRecorded: 1,
      ServiceSessionLinesAdded: 1,
      ServiceLineChanged: 1,
      SessionTipsChanged: 1,
      SalaryChanged: 1,
      PackageSaleChanged: 1,
    });
  });

  it('leaves the four-type scope on its own page and its own replayable types', async () => {
    // النطاق الافتراضي ما زال الأربعة: نفس الصفحة ونفس الأنواع ونفس النتيجة
    const events = [fakeEvent(1, 'ServiceSessionRecorded'), fakeEvent(2, 'SalaryChanged')];
    const reader = fakeReader(events);
    const deliver = vi.fn(delivered);

    const result = await runCommissionInputReplay(
      { reader, deliver, failures: new Map() },
      { companyId: COMPANY, afterId: null, throughId: null },
    );

    expect(reader.commissionInputReplayPage).toHaveBeenCalledTimes(1);
    expect(reader.commissionRetainedEventPage).not.toHaveBeenCalled();
    expect(result.status).toBe('COMPLETE');
    expect(result.undelivered).toEqual([]);
  });
});

describe('runCommissionInputReplay: the six-type result line', () => {
  it('keeps the payload out of the six-type result', async () => {
    const events = [fakeEvent(1, 'ServiceSessionRecorded'), fakeEvent(2, 'PackageSaleChanged')];
    const reader = fakeReader(events);
    const deliver = vi.fn(delivered);
    const failures: CommissionFailureCodes = new Map();

    const result = await runCommissionInputReplay(
      { reader, deliver, failures, scope: 'SIX_TYPE', handledTypes: HANDLED_SIX },
      { companyId: COMPANY, afterId: null, throughId: null },
    );

    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain('sensitive');
    expect(serialized).not.toContain('payload');
  });
});

/** مجموع أعداد التسليم؛ الأعداد لكل نوع لوحدها مش بتقول حجم التشغيل كله. */
const deliveredCount = (counts: Record<string, number>): number =>
  Object.values(counts).reduce((sum, value) => sum + value, 0);

/**
 * نوع الحدث بالموقع، والأنواع الستة بالتناوب؛ الباقي داخل القائمة دايماً لأن طولها ثابت،
 * والعنصر الأول احتياط لسطح النوع فقط: الفهرسة برقم مش معروف بترجع قيمة من غيرها.
 */
const eventTypeAt = (index: number): string =>
  COMMISSION_INPUT_EVENT_TYPES[index % COMMISSION_INPUT_EVENT_TYPES.length] ??
  COMMISSION_INPUT_EVENT_TYPES[0];

describe('runCommissionInputReplay: a six-type replay over more than a hundred pages', () => {
  it('stops at the page limit, resumes from afterId and ends COMPLETE with no unhandled type', async () => {
    // مئة صفحة كاملة وبعدها خمسون حدث: التشغيل الأول بيقف عند حد الصفحات، والاستئناف بنفس المؤشرين
    // بيكمل. الأنواع الستة متناوبة في كل الأحداث، فأي نوع غير مسجَّل كان بيظهر في العدّاد.
    const total = 10_050;
    const events = Array.from({ length: total }, (_row, index) =>
      fakeEvent(index + 1, eventTypeAt(index)),
    );
    const reader = fakeReader(events);
    const deliver = vi.fn(delivered);

    const first = await runCommissionInputReplay(
      {
        reader,
        deliver,
        failures: new Map(),
        scope: 'SIX_TYPE',
        handledTypes: HANDLED_SIX,
      },
      { companyId: COMPANY, afterId: null, throughId: null },
    );

    expect(first.status).toBe('PAGE_LIMIT');
    expect(first.undelivered).toEqual([]);
    expect(deliveredCount(first.counts)).toBe(10_000);
    expect(Object.keys(first.counts).sort()).toEqual([...COMMISSION_INPUT_EVENT_TYPES].sort());

    const second = await runCommissionInputReplay(
      {
        reader,
        deliver,
        failures: new Map(),
        scope: 'SIX_TYPE',
        handledTypes: HANDLED_SIX,
      },
      { companyId: COMPANY, afterId: first.afterId, throughId: first.throughId },
    );

    expect(second.status).toBe('COMPLETE');
    expect(second.undelivered).toEqual([]);
    expect(deliveredCount(second.counts)).toBe(50);
    expect(deliver).toHaveBeenCalledTimes(total);
    expect(second.afterId).toBe(eventId(total));
    expect(second.throughId).toBe(eventId(total));
  });
});
