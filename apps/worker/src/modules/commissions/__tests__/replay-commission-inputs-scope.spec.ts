import type { ClaimedEvent, DeliveryOutcome } from '@pospay/db';
import { ReplayCursorError } from '@pospay/db';
import { describe, expect, it, vi } from 'vitest';

import {
  CommissionCandidateRangeExceededError,
  CommissionPeriodInvalidError,
} from '../domain/errors.ts';
import {
  CommissionReplayCursorError,
  commissionReplayErrorCode,
  recordCommissionFailureCodes,
  type CommissionFailureCodes,
} from '../jobs/replay-commission-inputs.ts';
import { runCommissionInputReplay } from '../index.ts';

const COMPANY = '01920000-0000-7000-8000-0000000000a0';
const eventId = (n: number) => `01970000-0000-7000-8000-${String(n).padStart(12, '0')}`;

function emptyReader() {
  const page = vi.fn(async () => ({ throughId: null, events: [] }));
  return { commissionInputReplayPage: page, commissionRetainedEventPage: page };
}

function fakeEvent(n: number): ClaimedEvent {
  return {
    companyId: COMPANY,
    id: eventId(n),
    aggregateType: 'service_session',
    aggregateId: eventId(n),
    eventType: 'ServiceSessionRecorded',
    payload: {},
    attempt: 1,
  };
}

/** استعادة بحدث واحد يرفضه المستهلك؛ الـ deliver بيرجّع نتيجة التوصيل زي ما بيعمل العامل. */
async function replayWithRefusal(thrown: Error, event: ClaimedEvent) {
  const failures: CommissionFailureCodes = new Map();
  const reader = {
    commissionInputReplayPage: vi.fn(async () => ({ throughId: event.id, events: [event] })),
    commissionRetainedEventPage: vi.fn(async () => ({ throughId: null, events: [] })),
  };
  const consumer = {
    id: 'commissions.project-inputs',
    eventTypes: ['ServiceSessionRecorded'],
    handle: async () => {
      throw thrown;
    },
  };
  const wrapped = recordCommissionFailureCodes(consumer, failures);
  const deliver = async (claimed: ClaimedEvent): Promise<DeliveryOutcome> => {
    try {
      await wrapped.handle({} as never, claimed);
      return { delivered: true };
    } catch {
      return { delivered: false, error: 'failed', retryInMs: 1000 };
    }
  };
  return runCommissionInputReplay(
    { reader, deliver, failures },
    { companyId: COMPANY, afterId: null, throughId: null },
  );
}

describe('commissionReplayErrorCode invalid scope (#993)', () => {
  it('maps TypeError(REPLAY_SCOPE_INVALID) to REPLAY_SCOPE_INVALID and keeps other TypeErrors generic', () => {
    // نطاق غير صالح بيطلع من قارئ الصفحات كـ TypeError بالرسالة الثابتة، والعميل بيشوف رمزه.
    expect(commissionReplayErrorCode(new TypeError('REPLAY_SCOPE_INVALID'))).toBe(
      'REPLAY_SCOPE_INVALID',
    );
    expect(commissionReplayErrorCode(new TypeError('other'))).toBe('COMMISSION_REPLAY_FAILED');
  });
});

describe('the wired replay runner (#1000)', () => {
  it('uses the bound persistence guard for the cursor bounds', async () => {
    // الحارس المربوط من persistence هو اللي بيرمي خطأ مخزن البيانات.
    const reader = emptyReader();
    await expect(
      runCommissionInputReplay(
        { reader, deliver: vi.fn(), failures: new Map() },
        { companyId: COMPANY, afterId: 'not-a-uuid', throughId: null },
      ),
    ).rejects.toThrow(ReplayCursorError);
    expect(reader.commissionInputReplayPage).not.toHaveBeenCalled();
  });

  it('keeps the refusal of a resume without an upper bound', async () => {
    const reader = emptyReader();
    await expect(
      runCommissionInputReplay(
        { reader, deliver: vi.fn(), failures: new Map() },
        { companyId: COMPANY, afterId: eventId(10), throughId: null },
      ),
    ).rejects.toThrow(CommissionReplayCursorError);
    expect(reader.commissionInputReplayPage).not.toHaveBeenCalled();
  });
});

describe('the continuable refusals of the replay (GR-002)', () => {
  it.each([
    ['the candidate range is too wide', new CommissionCandidateRangeExceededError(120)],
    ['the period is not a calendar month', new CommissionPeriodInvalidError('2026-13')],
  ])('reports %s as undelivered and does not abort the run', async (_label, thrown) => {
    // الرفضين رفض عمل معروفين: الاستعادة بتكمّل بالصفحة وبتبلّغ عن الحدث غير المسلّم.
    const event = fakeEvent(1);
    const result = await replayWithRefusal(thrown, event);

    expect(result.status).toBe('UNDELIVERED');
    expect(result.undelivered).toEqual([
      { eventId: event.id, type: 'ServiceSessionRecorded', code: thrown.code },
    ]);
  });
});
