import type { Tx } from '@pospay/db';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { teamAlertRecipientContacts } from '../persistence/team-alert-recipient-contacts.ts';

// ADR-0003 §6a: القارئ بينادي دالة القراءة المحدودة بس، بمجموعات لا تتعدى مئة معرّف، ومفتاح الإيميل الموثّق ظاهر في الاستدعاء.
const COMPANY = '01920000-0000-7000-8000-0000000000a0';
const AT = new Date('2026-11-27T05:00:00.123Z');
const id = (n: number) => `01920000-0000-7000-8000-${String(n).padStart(12, '0')}`;
const dialect = new PgDialect();

function fakeTx(answer: (call: number) => { user_id: string; email: string | null; phone_number: string | null }[]) {
  const calls: { text: string; params: unknown[] }[] = [];
  const tx = {
    execute: async (statement: SQL) => {
      const query = dialect.sqlToQuery(statement);
      calls.push({ text: query.sql, params: query.params });
      return answer(calls.length);
    },
  } as unknown as Tx;
  return { tx, calls };
}

describe('teamAlertRecipientContacts', () => {
  it('reads nothing for an empty list', async () => {
    const { tx, calls } = fakeTx(() => []);
    expect(await teamAlertRecipientContacts(tx, COMPANY, [], AT)).toEqual(new Map());
    expect(calls).toHaveLength(0);
  });

  it('goes through the definer only, binding the company, the instant and the verified-email switch (true by default)', async () => {
    const { tx, calls } = fakeTx(() => [
      { user_id: id(1), email: 'a@example.test', phone_number: null },
    ]);
    const contacts = await teamAlertRecipientContacts(tx, COMPANY, [id(1)], AT);
    expect(contacts.get(id(1))).toEqual({ email: 'a@example.test', phoneNumber: null });
    const [call] = calls;
    expect(call?.text).toContain('public.team_alert_recipient_contacts(');
    expect(call?.text).not.toMatch(/FROM\s+"?user"?/i);
    expect(call?.params).toContain(COMPANY);
    expect(call?.params).toContain(AT.toISOString());
    expect(call?.params).toContain(true);
  });

  it('passes the verified-email switch through when it is turned off', async () => {
    const { tx, calls } = fakeTx(() => []);
    await teamAlertRecipientContacts(tx, COMPANY, [id(1)], AT, { requireVerifiedEmail: false });
    expect(calls[0]?.params).toContain(false);
    expect(calls[0]?.params).not.toContain(true);
  });

  it('cuts the ids into calls of at most a hundred and drops repeated ids', async () => {
    const ids = Array.from({ length: 205 }, (_, i) => id(i + 1));
    const { tx, calls } = fakeTx((call) => [
      { user_id: id(call), email: `u${call}@example.test`, phone_number: null },
    ]);
    const contacts = await teamAlertRecipientContacts(tx, COMPANY, [...ids, ids[0] ?? ''], AT);
    expect(calls).toHaveLength(3);
    const bound = (call: number) =>
      (calls[call - 1]?.params ?? []).filter(
        (param) => typeof param === 'string' && param.startsWith('01920000'),
      ).length;
    expect([bound(1), bound(2), bound(3)]).toEqual([101, 101, 6]);
    expect([...contacts.keys()]).toEqual([id(1), id(2), id(3)]);
  });
});
