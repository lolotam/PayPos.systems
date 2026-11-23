import { insertCommissionLineProjection } from '../../../../../../packages/db/test/commission-line-fixtures.ts';
import { walkCommissionStatement } from '../../../../../../packages/db/test/commission-statement-fixtures.ts';
import { createDatabase } from '@pospay/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  auditAndOutboxCounts,
  generateStatement,
  ids,
  readStatement,
  statementFixture,
  statementRow,
  type StatementFixture,
} from './commission-statement.fixture.ts';

type View = {
  reader_scope: string;
  status: string;
  generated: boolean;
  current_fingerprint: string;
  current_statement_fingerprint: string;
  reviewed_fingerprint: string | null;
  changed_since_review: boolean;
  change_cause: string | null;
  employees: {
    employee_id: string;
    payable: string;
    rows: { kind: string; customer_name: string | null; service_name_en: string | null }[];
  }[];
};

let f: StatementFixture;

beforeAll(async () => {
  f = await statementFixture();
});

afterAll(async () => {
  await f?.h.close();
});

describe('CM-27 generating a month that has ended', () => {
  it('creates the DRAFT row, stores the input fingerprint and returns the view with the detail names', async () => {
    const before = await auditAndOutboxCounts(f);
    const response = await generateStatement(f, f.cookie, 'generate-november');

    expect(response.status).toBe(200);
    const view = response.body as unknown as View;
    expect(view).toMatchObject({ reader_scope: 'BUSINESS', status: 'DRAFT', generated: true });
    expect(view.employees).toHaveLength(2);
    expect(view.employees.map((employee) => employee.payable)).toEqual(['1.000', '1.000']);
    const sarah = view.employees.find((employee) => employee.employee_id === f.employee);
    expect(sarah?.rows).toEqual([
      expect.objectContaining({
        kind: 'COMMISSION',
        customer_name: 'Estimate customer',
        service_name_en: 'Estimate service',
      }),
    ]);
    const stored = await statementRow(f, '2026-11');
    expect(stored).toMatchObject({
      status: 'DRAFT',
      current_fingerprint: view.current_fingerprint,
      reviewed_fingerprint: null,
    });
    const after = await auditAndOutboxCounts(f);
    // تدقيق واحد، ومفيش حدث outbox جديد (قرار المدير 2026-11-23).
    expect(after).toEqual({ audits: before.audits + 1, outbox: before.outbox });
  });

  it('never puts a phone number or an amount into the audit entry', async () => {
    const [entry] = await f.h.owner`SELECT after FROM audit_log
      WHERE action='commission_statement.generated' ORDER BY at DESC LIMIT 1`;
    expect(Object.keys(entry?.['after'] as object).sort()).toEqual([
      'input_fingerprint',
      'period',
      'statement_fingerprint',
    ]);
    expect(JSON.stringify(entry)).not.toContain('+965');
  });

  it('returns no customer phone anywhere in the response', async () => {
    const response = await readStatement(f, f.cookie);
    expect(response.text).not.toContain('+965');
  });
});

describe('CM-28 the fingerprints are stable and move with the inputs', () => {
  it('gives the same fingerprints when generated twice and when read, and the read equals the stored one', async () => {
    const first = (await generateStatement(f, f.cookie, 'stable-1')).body as unknown as View;
    const second = (await generateStatement(f, f.cookie, 'stable-2')).body as unknown as View;
    const read = (await readStatement(f, f.cookie)).body as unknown as View;
    const stored = await statementRow(f, '2026-11');

    expect(second.current_fingerprint).toBe(first.current_fingerprint);
    expect(second.current_statement_fingerprint).toBe(first.current_statement_fingerprint);
    expect(read.current_fingerprint).toBe(first.current_fingerprint);
    expect(read.current_statement_fingerprint).toBe(first.current_statement_fingerprint);
    expect(stored?.['current_fingerprint']).toBe(first.current_fingerprint);
  });

  it('moves only the statement fingerprint when a customer is renamed (a label with no writer event)', async () => {
    const before = (await readStatement(f, f.cookie)).body as unknown as View;
    await f.h.owner`UPDATE customers SET name='Renamed customer' WHERE company_id=${f.company}
      AND id=${f.tenant.customer}`;
    const after = (await readStatement(f, f.cookie)).body as unknown as View;

    expect(after.current_fingerprint).toBe(before.current_fingerprint);
    expect(after.current_statement_fingerprint).not.toBe(before.current_statement_fingerprint);
  });

  it('moves the input fingerprint when a line is added, and generating again stores the new one', async () => {
    const before = (await readStatement(f, f.cookie)).body as unknown as View;
    const db = createDatabase({ url: f.h.urls.app, ids });
    await db.withTenant(f.company, (tx) =>
      insertCommissionLineProjection(tx, f.tenant, ids, {
        lineId: ids.newId(),
        businessDate: '2026-11-06',
        period: '2026-11',
        net: '20.000',
        ruleKind: 'PCT',
        rulePctBps: 1000,
      }),
    );
    await db.close();
    const after = (await readStatement(f, f.cookie)).body as unknown as View;
    expect(after.current_fingerprint).not.toBe(before.current_fingerprint);

    const generated = (await generateStatement(f, f.cookie, 'after-new-line')).body as unknown as View;
    expect((await statementRow(f, '2026-11'))?.['current_fingerprint']).toBe(
      generated.current_fingerprint,
    );
  });
});

describe('CM-29 generating a month that has not ended', () => {
  it('is refused with COMMISSION_PERIOD_NOT_ENDED, creates no row and leaves the estimate readable', async () => {
    const response = await generateStatement(f, f.cookie, 'december', '2026-12');

    expect(response.status).toBe(422);
    expect((response.body as { code: string }).code).toBe('COMMISSION_PERIOD_NOT_ENDED');
    expect(await statementRow(f, '2026-12')).toBeUndefined();
    const estimate = await f.h.send(
      'GET',
      `/v1/businesses/${f.business}/commissions/periods/2026-12/estimate`,
      { cookie: f.cookie, company: f.company },
    );
    expect(estimate.status).toBe(200);
  });
});

describe('generating on a statement that already has a status (D-5, FR-025, FR-029)', () => {
  async function walk(period: string, to: 'REVIEWED' | 'APPROVED' | 'PAID'): Promise<void> {
    const db = createDatabase({ url: f.h.urls.app, ids });
    const [owner] = await f.h.owner`SELECT user_id, id FROM memberships
      WHERE company_id=${f.company} AND scope_type='COMPANY' LIMIT 1`;
    await walkCommissionStatement(db, {
      tenant: { ...f.tenant, membership: owner?.['id'] as string },
      reviewer: owner?.['user_id'] as string,
      period,
      ids,
      to,
    });
    await db.close();
  }

  it('on REVIEWED stores the current fingerprint only and keeps the status and reviewed values', async () => {
    await walk('2026-10', 'REVIEWED');
    const before = await statementRow(f, '2026-10');
    const response = await generateStatement(f, f.cookie, 'reviewed-october', '2026-10');

    expect(response.status).toBe(200);
    const view = response.body as unknown as View;
    expect(view).toMatchObject({ status: 'REVIEWED', changed_since_review: true });
    const after = await statementRow(f, '2026-10');
    expect(after).toMatchObject({
      status: 'REVIEWED',
      reviewed_fingerprint: before?.['reviewed_fingerprint'],
      reviewed_statement_fingerprint: before?.['reviewed_statement_fingerprint'],
      current_fingerprint: view.current_fingerprint,
    });
  });

  it.each([
    ['2026-09', 'APPROVED'],
    ['2026-08', 'PAID'],
  ] as const)('refuses %s (%s) with COMMISSION_PERIOD_CLOSED and writes nothing', async (period, status) => {
    await walk(period, status);
    const before = await auditAndOutboxCounts(f);
    const response = await generateStatement(f, f.cookie, `closed-${period}`, period);

    expect(response.status).toBe(409);
    expect((response.body as { code: string }).code).toBe('COMMISSION_PERIOD_CLOSED');
    expect((await statementRow(f, period))?.['current_fingerprint']).toBeNull();
    expect(await auditAndOutboxCounts(f)).toEqual(before);
  });

  it('refuses to read a closed month until the frozen read ships with the approval part', async () => {
    const response = await readStatement(f, f.cookie, '2026-09');
    expect(response.status).toBe(409);
    expect((response.body as { code: string }).code).toBe('COMMISSION_PERIOD_CLOSED');
  });
});

describe('replaying a generate request', () => {
  it('returns the stored view for the same key and a 422 for the same key on another month', async () => {
    const first = await generateStatement(f, f.cookie, 'replay-key');
    const replay = await generateStatement(f, f.cookie, 'replay-key');
    expect(replay.status).toBe(200);
    expect(replay.body).toEqual(first.body);

    const reused = await generateStatement(f, f.cookie, 'replay-key', '2026-10');
    expect(reused.status).toBe(422);
    expect((reused.body as { code: string }).code).toBe('IDEMPOTENCY_KEY_REUSED');
  });
});
