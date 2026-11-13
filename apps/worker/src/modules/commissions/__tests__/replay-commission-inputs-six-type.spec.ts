import type { ClaimedEvent, DeliveryOutcome } from '@pospay/db';
import { describe, expect, it, vi } from 'vitest';

import {
  runCommissionInputReplay,
  type CommissionFailureCodes,
} from '../jobs/replay-commission-inputs.ts';

const COMPANY = '01920000-0000-7000-8000-0000000000a0';
const eventId = (n: number) => `01970000-0000-7000-8000-${String(n).padStart(12, '0')}`;

// الأنواع الخمسة التي يسجّلها المستهلك؛ بيع الباقة ينضم لها في 50-4.
const HANDLED_FIVE = new Set([
  'ServiceSessionRecorded',
  'ServiceSessionLinesAdded',
  'ServiceLineChanged',
  'SessionTipsChanged',
  'SalaryChanged',
]);

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
    // نوع لا يسجّله المستهلك لا يُسلَّم أصلاً؛ يُدرج برمز ثابت ومؤشر الاستئناف يتوقف قبله
    const events = [
      fakeEvent(1, 'ServiceSessionRecorded'),
      fakeEvent(2, 'PackageSaleChanged'),
      fakeEvent(3, 'SalaryChanged'),
    ];
    const reader = fakeReader(events);
    const deliver = vi.fn(delivered);

    const result = await runCommissionInputReplay(
      { reader, deliver, failures: new Map(), scope: 'SIX_TYPE', handledTypes: HANDLED_FIVE },
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

  it('delivers the same event and ends COMPLETE once the consumer handles its type', async () => {
    // معالج نوع البيع في 50-4 يخلّي نفس الصف يتسلّم بلا تغيير في الـ runner
    const events = [fakeEvent(1, 'ServiceSessionRecorded'), fakeEvent(2, 'PackageSaleChanged')];
    const reader = fakeReader(events);
    const deliver = vi.fn(delivered);

    const result = await runCommissionInputReplay(
      {
        reader,
        deliver,
        failures: new Map(),
        scope: 'SIX_TYPE',
        handledTypes: new Set([...HANDLED_FIVE, 'PackageSaleChanged']),
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
        handledTypes: new Set([...HANDLED_FIVE, 'PackageSaleChanged']),
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
      { reader, deliver, failures, scope: 'SIX_TYPE', handledTypes: HANDLED_FIVE },
      { companyId: COMPANY, afterId: null, throughId: null },
    );

    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain('sensitive');
    expect(serialized).not.toContain('payload');
  });
});
