import type { ClaimedEvent, DeliveryOutcome } from '@pospay/db';
import { ReplayCursorError } from '@pospay/db';
import { describe, expect, it, vi } from 'vitest';

import type { OutboxConsumer } from '../../../outbox/consumer.ts';
import {
  CommissionReplayCursorError,
  CommissionReplayEventInvalidError,
  recordCommissionFailureCodes,
  runCommissionInputReplay,
  type CommissionFailureCodes,
} from '../jobs/replay-commission-inputs.ts';

const COMPANY = '01920000-0000-7000-8000-0000000000a0';
const OTHER_COMPANY = '01920000-0000-7000-8000-0000000000b0';
const eventId = (n: number) => `01970000-0000-7000-8000-${String(n).padStart(12, '0')}`;

const CONTINUABLE_FAILURE_CODES = [
  'COMMISSION_EMPLOYEE_BUSINESS_MISSING',
  'COMMISSION_LINE_EVENT_INVALID',
  'COMMISSION_TIP_SALARY_INPUT_INVALID',
  'COMMISSION_BUSINESS_MISSING',
  'COMMISSION_PERIOD_CLOSED',
] as const;

function fakeEvent(n: number, eventType = 'ServiceSessionRecorded', companyId = COMPANY): ClaimedEvent {
  return {
    companyId,
    id: eventId(n),
    aggregateType: 'service_session',
    aggregateId: eventId(n),
    eventType,
    payload: { sensitive: 'should-never-leak', n },
    attempt: 1,
  };
}

function fakeReader(events: readonly ClaimedEvent[]) {
  return {
    commissionInputReplayPage: vi.fn(
      async (companyId: string, afterId: string | null, throughId: string | null, limit: number) => {
        const companyEvents = events.filter((e) => e.companyId === companyId);
        const resolvedThroughId = throughId ?? companyEvents.at(-1)?.id ?? null;
        if (resolvedThroughId === null) return { throughId: null, events: [] };
        const filtered = companyEvents.filter(
          (e) => (afterId === null || e.id > afterId) && e.id <= resolvedThroughId,
        );
        return { throughId: resolvedThroughId, events: filtered.slice(0, limit) };
      },
    ),
  };
}

it('delivers all pages, counts per event type, COMPLETE, afterId = last id, throughId fixed from first page', async () => {
  // يوزّع 150 حدثاً على صفحتين للتأكد من ثبات الحد الأعلى واستمرار الترحيل لآخر معرف
  const events = [
    ...Array.from({ length: 50 }, (_, i) => fakeEvent(i + 1, 'ServiceSessionRecorded')),
    ...Array.from({ length: 50 }, (_, i) => fakeEvent(i + 51, 'ServiceSessionLinesAdded')),
    ...Array.from({ length: 25 }, (_, i) => fakeEvent(i + 101, 'ServiceLineChanged')),
    ...Array.from({ length: 25 }, (_, i) => fakeEvent(i + 126, 'SalaryChanged')),
  ];
  const reader = fakeReader(events);
  const deliver = vi.fn(async (): Promise<DeliveryOutcome> => ({ delivered: true }));
  const result = await runCommissionInputReplay({ reader, deliver, failures: new Map() }, { companyId: COMPANY, afterId: null, throughId: null });

  expect(result).toEqual({
    status: 'COMPLETE',
    afterId: eventId(150),
    handledThroughId: eventId(150),
    throughId: eventId(150),
    counts: { ServiceSessionRecorded: 50, ServiceSessionLinesAdded: 50, ServiceLineChanged: 25, SalaryChanged: 25 },
    undelivered: [],
    truncated: false,
  });
  expect(deliver).toHaveBeenCalledTimes(150);
  expect(reader.commissionInputReplayPage).toHaveBeenNthCalledWith(1, COMPANY, null, null, 100);
  expect(reader.commissionInputReplayPage).toHaveBeenNthCalledWith(2, COMPANY, eventId(100), eventId(150), 100);
});

it.each(CONTINUABLE_FAILURE_CODES)(
  'records allowlisted failure code %s in undelivered without payload and continues',
  async (code) => {
    // خطأ العمل المسموح لا يوقف التشغيل وتُسجل الهوية والنوع والرمز دون كشف حمولة الحدث
    const events = [fakeEvent(1, 'ServiceSessionRecorded'), fakeEvent(2, 'ServiceLineChanged'), fakeEvent(3, 'SalaryChanged')];
    const failures: CommissionFailureCodes = new Map();
    const deliver = vi.fn(async (event: ClaimedEvent): Promise<DeliveryOutcome> => {
      if (event.id === eventId(2)) { failures.set(event.id, code); return { delivered: false, error: code, retryInMs: 1000 }; }
      return { delivered: true };
    });

    const result = await runCommissionInputReplay({ reader: fakeReader(events), deliver, failures }, { companyId: COMPANY, afterId: null, throughId: null });
    expect(result).toEqual({
      status: 'UNDELIVERED',
      afterId: eventId(1),
      handledThroughId: eventId(3),
      throughId: eventId(3),
      counts: { ServiceSessionRecorded: 1, SalaryChanged: 1 },
      undelivered: [{ eventId: eventId(2), type: 'ServiceLineChanged', code }],
      truncated: false,
    });
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain('sensitive');
    expect(serialized).not.toContain('payload');
  },
);

it('freezes afterId at starting cursor when first event fails, with handledThroughId at last event', async () => {
  // تعثر أول حدث يجمد مؤشر الاستئناف عند المؤشر الأولي مع وصول آخر معالجة إلى نهاية النطاق
  const events = [fakeEvent(1, 'ServiceSessionRecorded'), fakeEvent(2, 'ServiceLineChanged'), fakeEvent(3, 'SalaryChanged')];
  const failures: CommissionFailureCodes = new Map();
  const deliver = vi.fn(async (e: ClaimedEvent): Promise<DeliveryOutcome> => {
    if (e.id === eventId(1)) { failures.set(e.id, 'COMMISSION_BUSINESS_MISSING'); return { delivered: false, error: 'COMMISSION_BUSINESS_MISSING', retryInMs: 1000 }; }
    return { delivered: true };
  });

  const result = await runCommissionInputReplay({ reader: fakeReader(events), deliver, failures }, { companyId: COMPANY, afterId: null, throughId: null });
  expect(result).toEqual({
    status: 'UNDELIVERED',
    afterId: null,
    handledThroughId: eventId(3),
    throughId: eventId(3),
    counts: { ServiceLineChanged: 1, SalaryChanged: 1 },
    undelivered: [{ eventId: eventId(1), type: 'ServiceSessionRecorded', code: 'COMMISSION_BUSINESS_MISSING' }],
    truncated: false,
  });
});

it('aborts on unknown or missing failure code with ABORTED and safe cursors even after undelivered', async () => {
  // العطل غير المسموح أو غياب الرمز يوقف الاستعادة مع الاحتفاظ بآخر مؤشر آمن وآخر حدث عولج
  const events = [fakeEvent(1, 'ServiceSessionRecorded'), fakeEvent(2, 'ServiceLineChanged'), fakeEvent(3, 'SalaryChanged')];
  const reader = fakeReader(events);
  const failures: CommissionFailureCodes = new Map();
  const deliverUnknown = vi.fn(async (e: ClaimedEvent): Promise<DeliveryOutcome> => {
    if (e.id === eventId(2)) { failures.set(e.id, 'UNKNOWN_FATAL_ERROR'); return { delivered: false, error: 'UNKNOWN_FATAL_ERROR', retryInMs: 1000 }; }
    return { delivered: true };
  });
  const result = await runCommissionInputReplay({ reader, deliver: deliverUnknown, failures }, { companyId: COMPANY, afterId: null, throughId: null });
  expect(result.status).toBe('ABORTED');
  expect(result.afterId).toBe(eventId(1));
  expect(result.handledThroughId).toBe(eventId(1));
  expect(deliverUnknown).toHaveBeenCalledTimes(2);

  // حالة غياب رمز الخطأ تماماً من خريطة الفشل
  failures.clear();
  const missingResult = await runCommissionInputReplay(
    { reader, deliver: vi.fn(async (e: ClaimedEvent): Promise<DeliveryOutcome> => e.id === eventId(2) ? { delivered: false, error: 'NO_CODE', retryInMs: 1000 } : { delivered: true }), failures },
    { companyId: COMPANY, afterId: null, throughId: null },
  );
  expect(missingResult.status).toBe('ABORTED');
  expect(missingResult.afterId).toBe(eventId(1));
  expect(missingResult.handledThroughId).toBe(eventId(1));

  // حالة الفشل القاطع بعد حدث متعثر مسموح: يجمد afterId عند ما قبله ويتقدم handledThroughId
  failures.clear();
  const abortAfterResult = await runCommissionInputReplay(
    {
      reader,
      deliver: vi.fn(async (e: ClaimedEvent): Promise<DeliveryOutcome> => {
        if (e.id === eventId(2)) { failures.set(e.id, 'COMMISSION_PERIOD_CLOSED'); return { delivered: false, error: 'COMMISSION_PERIOD_CLOSED', retryInMs: 1000 }; }
        if (e.id === eventId(3)) { failures.set(e.id, 'FATAL_UNKNOWN'); return { delivered: false, error: 'FATAL_UNKNOWN', retryInMs: 1000 }; }
        return { delivered: true };
      }),
      failures,
    },
    { companyId: COMPANY, afterId: null, throughId: null },
  );
  expect(abortAfterResult.status).toBe('ABORTED');
  expect(abortAfterResult.afterId).toBe(eventId(1));
  expect(abortAfterResult.handledThroughId).toBe(eventId(2));
  expect(abortAfterResult.undelivered).toEqual([{ eventId: eventId(2), type: 'ServiceLineChanged', code: 'COMMISSION_PERIOD_CLOSED' }]);
});

it('sets truncated to true and caps list length at 200 when undelivered exceeds limit', async () => {
  // يمنع استهلاك الذاكرة بحصر قائمة الأحداث المتعثرة عند 200 مع رفع راية الاقتطاع
  const events = Array.from({ length: 205 }, (_, i) => fakeEvent(i + 1));
  const failures: CommissionFailureCodes = new Map();
  const deliver = vi.fn(async (e: ClaimedEvent): Promise<DeliveryOutcome> => {
    failures.set(e.id, 'COMMISSION_PERIOD_CLOSED');
    return { delivered: false, error: 'COMMISSION_PERIOD_CLOSED', retryInMs: 1000 };
  });

  const result = await runCommissionInputReplay({ reader: fakeReader(events), deliver, failures }, { companyId: COMPANY, afterId: null, throughId: null });
  expect(result.status).toBe('UNDELIVERED');
  expect(result.afterId).toBeNull();
  expect(result.handledThroughId).toBe(eventId(205));
  expect(result.throughId).toBe(eventId(205));
  expect(result.truncated).toBe(true);
  expect(result.undelivered).toHaveLength(200);
  expect(result.undelivered[0]).toEqual({ eventId: eventId(1), type: 'ServiceSessionRecorded', code: 'COMMISSION_PERIOD_CLOSED' });
  expect(result.undelivered[199]).toEqual({ eventId: eventId(200), type: 'ServiceSessionRecorded', code: 'COMMISSION_PERIOD_CLOSED' });
});

it('throws CommissionReplayEventInvalidError for another company or non-replayable event type', async () => {
  // الرفض الفوري يحمي من تسليم أحداث خارج نطاق الشركة أو أحداث غير معتمدة للاستعادة
  const otherCompanyEvent = fakeEvent(1, 'ServiceSessionRecorded', OTHER_COMPANY);
  const leakyReader = { commissionInputReplayPage: vi.fn(async () => ({ throughId: otherCompanyEvent.id, events: [otherCompanyEvent] })) };
  await expect(
    runCommissionInputReplay({ reader: leakyReader, deliver: vi.fn(), failures: new Map() }, { companyId: COMPANY, afterId: null, throughId: null }),
  ).rejects.toThrow(CommissionReplayEventInvalidError);

  const tipsEvent = fakeEvent(2, 'SessionTipsChanged', COMPANY);
  await expect(
    runCommissionInputReplay({ reader: fakeReader([tipsEvent]), deliver: vi.fn(), failures: new Map() }, { companyId: COMPANY, afterId: null, throughId: null }),
  ).rejects.toThrow(CommissionReplayEventInvalidError);
});

it('stops at PAGE_LIMIT with resumable afterId when 100 full pages are read', async () => {
  // التوقف عند 100 صفحة يحمي العامل من الاحتكار ويتيح استكمال التشغيل بالمؤشر
  let pageCounter = 0;
  const pagedReader = {
    commissionInputReplayPage: vi.fn(async (_c, _a, throughId, limit) => {
      const pageIndex = pageCounter++;
      return { throughId: throughId ?? eventId(20000), events: Array.from({ length: limit }, (_, i) => fakeEvent(pageIndex * limit + i + 1)) };
    }),
  };

  const result = await runCommissionInputReplay(
    { reader: pagedReader, deliver: vi.fn(async (): Promise<DeliveryOutcome> => ({ delivered: true })), failures: new Map() },
    { companyId: COMPANY, afterId: null, throughId: null },
  );
  expect(result.status).toBe('PAGE_LIMIT');
  expect(result.afterId).toBe(eventId(10000));
  expect(result.handledThroughId).toBe(eventId(10000));
  expect(pagedReader.commissionInputReplayPage).toHaveBeenCalledTimes(100);
});

it('returns COMPLETE with throughId null for empty company, and COMPLETE for afterId == throughId without delivering', async () => {
  // الشركة الفارغة أو الحدود المتطابقة تُنهي العمل فوراً دون أي نداء توصيل
  const emptyReader = fakeReader([]);
  const deliver = vi.fn();
  const emptyResult = await runCommissionInputReplay({ reader: emptyReader, deliver, failures: new Map() }, { companyId: COMPANY, afterId: null, throughId: null });
  expect(emptyResult).toEqual({ status: 'COMPLETE', afterId: null, handledThroughId: null, throughId: null, counts: {}, undelivered: [], truncated: false });
  expect(deliver).not.toHaveBeenCalled();

  const boundedResult = await runCommissionInputReplay({ reader: emptyReader, deliver, failures: new Map() }, { companyId: COMPANY, afterId: eventId(10), throughId: eventId(10) });
  expect(boundedResult).toEqual({ status: 'COMPLETE', afterId: eventId(10), handledThroughId: eventId(10), throughId: eventId(10), counts: {}, undelivered: [], truncated: false });
  expect(deliver).not.toHaveBeenCalled();
});

it('handles reader failure: returns ABORTED on generic Error, rethrows ReplayCursorError and invalid scope TypeError', async () => {
  // انقطاع القراءة العرضي بعد صفحة ناجحة يرجع حالة ملغاة مع الاحتفاظ بآخر مؤشرات بينما أخطاء النطاق ترمى كفشل صريح
  const page1Events = Array.from({ length: 100 }, (_, i) => fakeEvent(i + 1));
  const genericReader = {
    commissionInputReplayPage: vi.fn()
      .mockResolvedValueOnce({ throughId: eventId(200), events: page1Events })
      .mockRejectedValueOnce(new Error('transient read failure')),
  };
  const result = await runCommissionInputReplay(
    { reader: genericReader, deliver: vi.fn(async (): Promise<DeliveryOutcome> => ({ delivered: true })), failures: new Map() },
    { companyId: COMPANY, afterId: null, throughId: null },
  );
  expect(result).toEqual({
    status: 'ABORTED',
    afterId: eventId(100),
    handledThroughId: eventId(100),
    throughId: eventId(200),
    counts: { ServiceSessionRecorded: 100 },
    undelivered: [],
    truncated: false,
  });

  const cursorReader = { commissionInputReplayPage: vi.fn().mockRejectedValue(new ReplayCursorError()) };
  await expect(
    runCommissionInputReplay({ reader: cursorReader, deliver: vi.fn(), failures: new Map() }, { companyId: COMPANY, afterId: null, throughId: null }),
  ).rejects.toThrow(ReplayCursorError);

  const scopeReader = { commissionInputReplayPage: vi.fn().mockRejectedValue(new TypeError('REPLAY_SCOPE_INVALID')) };
  await expect(
    runCommissionInputReplay({ reader: scopeReader, deliver: vi.fn(), failures: new Map() }, { companyId: COMPANY, afterId: null, throughId: null }),
  ).rejects.toThrow('REPLAY_SCOPE_INVALID');
});

it('asserts replay cursor: rejects afterId without throughId before reader is called, accepts valid cursors', async () => {
  // يرفض الاستئناف دون حد أعلى قبل استدعاء القارئ ويقبل المؤشرات الصالحة معاً أو فارغة
  const reader = fakeReader([]);
  const deliver = vi.fn();
  const invalid = runCommissionInputReplay(
    { reader, deliver, failures: new Map() },
    { companyId: COMPANY, afterId: eventId(10), throughId: null },
  );
  await expect(invalid).rejects.toThrow(CommissionReplayCursorError);
  await expect(invalid).rejects.toMatchObject({ code: 'COMMISSION_REPLAY_THROUGH_REQUIRED' });
  expect(reader.commissionInputReplayPage).not.toHaveBeenCalled();

  await expect(
    runCommissionInputReplay({ reader, deliver, failures: new Map() }, { companyId: COMPANY, afterId: eventId(10), throughId: eventId(20) }),
  ).resolves.toMatchObject({ status: 'COMPLETE' });

  await expect(
    runCommissionInputReplay({ reader, deliver, failures: new Map() }, { companyId: COMPANY, afterId: null, throughId: null }),
  ).resolves.toMatchObject({ status: 'COMPLETE' });
});

describe('recordCommissionFailureCodes', () => {
  it('records thrown error code or UNKNOWN and rethrows original error while leaving success untouched', async () => {
    // يلتقط رمز الخطأ المستقر في الخريطة ويعيد رمي نفس كائن الخطأ لإلغاء المعاملة
    const failures: CommissionFailureCodes = new Map();
    const event = fakeEvent(1);
    const codedError = Object.assign(new Error('period closed'), { code: 'COMMISSION_PERIOD_CLOSED' });
    const consumer = (handle: OutboxConsumer['handle']): OutboxConsumer => ({
      id: 'commissions.project-inputs',
      eventTypes: ['ServiceSessionRecorded'],
      handle,
    });

    const wrappedFailing = recordCommissionFailureCodes(consumer(async () => { throw codedError; }), failures);
    await expect(wrappedFailing.handle({} as never, event)).rejects.toBe(codedError);
    expect(failures.get(event.id)).toBe('COMMISSION_PERIOD_CLOSED');

    // خطأ بلا خاصية code يأخذ UNKNOWN
    const genericError = new Error('database connection lost');
    const wrappedGeneric = recordCommissionFailureCodes(consumer(async () => { throw genericError; }), failures);
    await expect(wrappedGeneric.handle({} as never, event)).rejects.toBe(genericError);
    expect(failures.get(event.id)).toBe('UNKNOWN');

    // المعالجة الناجحة لا تضيف أي إدخال في خريطة الفشل
    const successEvent = fakeEvent(2);
    const wrappedSuccess = recordCommissionFailureCodes(consumer(async () => undefined), failures);
    await expect(wrappedSuccess.handle({} as never, successEvent)).resolves.toBeUndefined();
    expect(failures.has(successEvent.id)).toBe(false);
  });
});
