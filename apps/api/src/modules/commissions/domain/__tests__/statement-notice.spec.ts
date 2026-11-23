import { describe, expect, it } from 'vitest';

import {
  groupStatementNoticeRecipients,
  statementNoticeRecipients,
} from '../statement-notice.ts';

const user = (index: number) => `user-${String(index).padStart(3, '0')}`;

describe('groupStatementNoticeRecipients', () => {
  it('sorts, de-duplicates and cuts into consecutive groups of at most the size', () => {
    const groups = groupStatementNoticeRecipients([user(3), user(1), user(2), user(1)], 2);
    expect(groups).toEqual([[user(1), user(2)], [user(3)]]);
  });

  it('gives no group for no recipient', () => {
    expect(groupStatementNoticeRecipients([], 100)).toEqual([]);
  });

  it('refuses a size that is not a positive integer', () => {
    expect(() => groupStatementNoticeRecipients([user(1)], 0)).toThrow();
    expect(() => groupStatementNoticeRecipients([user(1)], 1.5)).toThrow();
  });

  it('keeps a hundred recipients in one group and cuts the hundred-and-first', () => {
    const many = Array.from({ length: 101 }, (_, index) => user(index + 1));
    const groups = groupStatementNoticeRecipients(many, 100);
    expect(groups.map((group) => group.length)).toEqual([100, 1]);
  });
});

describe('statementNoticeRecipients', () => {
  it('builds the in-app bell of the statement with the period only', () => {
    expect(statementNoticeRecipients([user(1)], '2026-11')).toEqual([
      {
        channel: 'IN_APP',
        user_id: user(1),
        locale: 'ar',
        template_key: 'statement_awaiting_approval',
        template_revision: 1,
        safe_parameters: [{ name: 'period', type: 'text', value: '2026-11' }],
      },
    ]);
  });

  it('carries no amount, no employee name and no customer data', () => {
    const payload = JSON.stringify(statementNoticeRecipients([user(1)], '2026-11'));
    expect(payload).not.toMatch(/amount|employee|customer|phone/i);
  });
});
