import { ReplayCursorError } from '@pospay/db';
import { describe, expect, it, vi } from 'vitest';

import {
  CommissionReplayCursorError,
  CommissionReplayScopeInvalidError,
  commissionReplayErrorCode,
  runCommissionInputReplay as wiredRunCommissionInputReplay,
} from '../index.ts';
import { runCommissionInputReplay } from '../jobs/replay-commission-inputs.ts';

const COMPANY = '01920000-0000-7000-8000-0000000000a0';
const eventId = (n: number) => `01970000-0000-7000-8000-${String(n).padStart(12, '0')}`;

function emptyReader() {
  const page = vi.fn(async () => ({ throughId: null, events: [] }));
  return { commissionInputReplayPage: page, commissionRetainedEventPage: page };
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
    // الحارس المربوط من persistence هو اللي بيرمي خطأ مخزن البيانات، والحارس البديل
    // النقي في jobs بيرمي خطأ محلي بنفس الرمز الثابت.
    const reader = emptyReader();
    await expect(
      wiredRunCommissionInputReplay(
        { reader, deliver: vi.fn(), failures: new Map() },
        { companyId: COMPANY, afterId: 'not-a-uuid', throughId: null },
      ),
    ).rejects.toThrow(ReplayCursorError);
    expect(reader.commissionInputReplayPage).not.toHaveBeenCalled();
  });

  it('keeps the refusal of a resume without an upper bound', async () => {
    const reader = emptyReader();
    await expect(
      wiredRunCommissionInputReplay(
        { reader, deliver: vi.fn(), failures: new Map() },
        { companyId: COMPANY, afterId: eventId(10), throughId: null },
      ),
    ).rejects.toThrow(CommissionReplayCursorError);
    expect(reader.commissionInputReplayPage).not.toHaveBeenCalled();
  });

  it('falls back to the pure guard when the runner has no bound guard', async () => {
    const reader = emptyReader();
    await expect(
      runCommissionInputReplay(
        { reader, deliver: vi.fn(), failures: new Map() },
        { companyId: COMPANY, afterId: 'not-a-uuid', throughId: null },
      ),
    ).rejects.toThrow(CommissionReplayScopeInvalidError);
    expect(reader.commissionInputReplayPage).not.toHaveBeenCalled();
  });
});
