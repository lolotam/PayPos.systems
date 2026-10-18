import { expect, it } from 'vitest';
import { recordingContext, recordingContextQuery, recordingDiscountLimit } from './recording-context.js';
const first = '00000000-0000-7000-8000-000000000001', second = '00000000-0000-7000-8000-000000000002';
const base = { generated_at: '2026-10-13T08:00:00.000Z', business_timezone: 'Asia/Kuwait', recorder_membership_ids: [first] };
it('normalizes selection and rejects arbitrary subjects and unknown query fields', () => {
  expect(recordingContextQuery.parse({})).toEqual({});
  expect(recordingContextQuery.parse({ recorder_membership_id: first.toUpperCase() })).toEqual({ recorder_membership_id: first });
  for (const input of [{ user_id: first }, { recorder_membership_id: 'bad' }, { limit: 1 }])
    expect(recordingContextQuery.safeParse(input).success).toBe(false);
});
it('strictly distinguishes ambiguity, unlimited, explicit zero and unconfigured zero', () => {
  for (const discount_limit of [{ source: 'OWNER', bps: null }, { source: 'PERSON', bps: 0 },
    { source: 'BUSINESS', bps: 10000 }, { source: 'NOT_CONFIGURED', bps: 0 }])
    expect(recordingContext.parse({ ...base, recorder_membership_id: first, discount_limit }).discount_limit).toEqual(discount_limit);
  expect(recordingContext.parse({ ...base, recorder_membership_ids: [first, second], recorder_membership_id: null, discount_limit: null }).discount_limit).toBeNull();
  for (const invalid of [{ source: 'OWNER', bps: 0 }, { source: 'PERSON', bps: null },
    { source: 'NOT_CONFIGURED', bps: 1 }, { source: 'BUSINESS', bps: 10001 }, { source: 'PERSON', bps: 0.5 }])
    expect(recordingDiscountLimit.safeParse(invalid).success).toBe(false);
  expect(recordingContext.safeParse({ ...base, recorder_membership_id: null, discount_limit: null }).success).toBe(false);
  const clean = { ...base, recorder_membership_id: first, discount_limit: { source: 'PERSON' as const, bps: 0 } };
  expect(recordingContext.parse({ ...clean, user_id: first })).toEqual(clean);
});
