import { describe, expect, it } from 'vitest';

import { statementNoticeRecipient } from '../statement-notice.ts';

describe('statementNoticeRecipient', () => {
  it('builds the in-app bell of the statement with the period only', () => {
    expect(statementNoticeRecipient('user-001', '2026-11')).toEqual({
      channel: 'IN_APP',
      user_id: 'user-001',
      locale: 'ar',
      template_key: 'statement_awaiting_approval',
      template_revision: 1,
      safe_parameters: [{ name: 'period', type: 'text', value: '2026-11' }],
    });
  });

  it('carries no amount, no employee name and no customer data', () => {
    const payload = JSON.stringify(statementNoticeRecipient('user-001', '2026-11'));
    expect(payload).not.toMatch(/amount|employee|customer|phone/i);
  });
});
