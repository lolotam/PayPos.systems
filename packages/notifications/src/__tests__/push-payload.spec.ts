import { describe, expect, it } from 'vitest';

import {
  buildPushPayload,
  PUSH_APP_PATH,
  PUSH_DEFAULT_TTL_SECONDS,
  PUSH_PAYLOAD_LIMIT_BYTES,
  pushTimeToLiveSeconds,
  pushTopic,
} from '../push/payload.ts';

const INPUT = {
  title: 'بصمة الحضور',
  body: 'لسه مفيش بصمة حضور ليك لشيفت الساعة 10:00 في Salmiya.',
  tag: 'shift_not_clocked_in_self',
  lang: 'ar' as const,
  token: '01920000-0000-4000-8000-0000000000d1',
};

// حمولة بحجم بالبايت محدد: العنوان هو الحقل الوحيد اللي بيتظبط.
const payloadOfBytes = (bytes: number): string | null => {
  const base = JSON.stringify({
    v: 1,
    title: 'x',
    body: 'y',
    tag: 'z',
    url: PUSH_APP_PATH,
    lang: 'ar',
    t: 't',
  });
  const title = 'x'.repeat(1 + (bytes - Buffer.byteLength(base, 'utf8')));
  return buildPushPayload({ title, body: 'y', tag: 'z', lang: 'ar', token: 't' });
};

describe('buildPushPayload', () => {
  it('builds the envelope with its keys in the fixed order', () => {
    const payload = buildPushPayload(INPUT);
    expect(payload).not.toBeNull();
    const parsed = JSON.parse(payload ?? '') as Record<string, unknown>;
    expect(Object.keys(parsed)).toEqual(['v', 'title', 'body', 'tag', 'url', 'lang', 't']);
    expect(parsed).toEqual({
      v: 1,
      title: INPUT.title,
      body: INPUT.body,
      tag: INPUT.tag,
      url: PUSH_APP_PATH,
      lang: 'ar',
      t: INPUT.token,
    });
  });

  it('counts Arabic in bytes and not in characters', () => {
    const body = 'ن'.repeat(600);
    expect(body.length).toBeLessThan(PUSH_PAYLOAD_LIMIT_BYTES);
    expect(Buffer.byteLength(body, 'utf8')).toBeGreaterThan(PUSH_PAYLOAD_LIMIT_BYTES);
    expect(buildPushPayload({ ...INPUT, body })).toBeNull();
  });

  it('takes exactly the limit and refuses one byte more', () => {
    const atLimit = payloadOfBytes(PUSH_PAYLOAD_LIMIT_BYTES);
    expect(atLimit).not.toBeNull();
    expect(Buffer.byteLength(atLimit ?? '', 'utf8')).toBe(PUSH_PAYLOAD_LIMIT_BYTES);
    expect(payloadOfBytes(PUSH_PAYLOAD_LIMIT_BYTES + 1)).toBeNull();
  });

  it('refuses an empty field', () => {
    expect(buildPushPayload({ ...INPUT, title: '' })).toBeNull();
    expect(buildPushPayload({ ...INPUT, body: '' })).toBeNull();
    expect(buildPushPayload({ ...INPUT, tag: '' })).toBeNull();
    expect(buildPushPayload({ ...INPUT, token: '' })).toBeNull();
  });
});

describe('pushTimeToLiveSeconds', () => {
  const now = new Date('2026-10-23T10:00:00Z');

  it('uses the default hour without a deadline', () => {
    expect(pushTimeToLiveSeconds(null, now)).toBe(PUSH_DEFAULT_TTL_SECONDS);
  });

  it('uses the seconds left, capped at the default hour', () => {
    expect(pushTimeToLiveSeconds(new Date(now.getTime() + 30_000), now)).toBe(30);
    expect(pushTimeToLiveSeconds(new Date(now.getTime() + 7_200_000), now)).toBe(
      PUSH_DEFAULT_TTL_SECONDS,
    );
  });

  it('refuses a deadline that passed or left less than a second', () => {
    expect(pushTimeToLiveSeconds(now, now)).toBeNull();
    expect(pushTimeToLiveSeconds(new Date(now.getTime() - 1_000), now)).toBeNull();
    expect(pushTimeToLiveSeconds(new Date(now.getTime() + 500), now)).toBeNull();
  });
});

describe('pushTopic', () => {
  it('is 32 base64url characters and stable for the same event', () => {
    const topic = pushTopic('01920000-0000-7000-8000-0000000000e1');
    expect(topic).toHaveLength(32);
    expect(topic).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(pushTopic('01920000-0000-7000-8000-0000000000e1')).toBe(topic);
    expect(pushTopic('01920000-0000-7000-8000-0000000000e2')).not.toBe(topic);
  });
});
